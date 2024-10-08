'use strict'
import PortFinder = require('portfinder')

import * as coc from 'coc.nvim'
import * as Path from 'path'
import * as FS from 'fs'
import * as Net from 'net'
import {
    Disposable, Event, Emitter, LanguageClient, StreamInfo, ServerOptions, ExecutableOptions, Executable, LanguageClientOptions, Position
} from 'coc.nvim'
import { getJavaExtension } from './classpath'
import { logToSpringBootOutput, initLogOutput } from './logging'
import { JVM, findJvm, findJdk } from '@pivotal-tools/jvm-launch-utils'
import { abort } from 'process'

const LOG_RESOLVE_VM_ARG_PREFIX = '-Xlog:jni+resolve='
const DEBUG_ARG = '-agentlib:jdwp=transport=dt_socket,server=y,address=8000,suspend=y'

PortFinder.basePort = 45556

export interface ActivatorOptions {
    DEBUG: boolean
    CONNECT_TO_LS?: boolean
    TRACE?: boolean
    extensionId: string
    clientOptions: LanguageClientOptions
    jvmHeap: string
    workspaceOptions: coc.WorkspaceConfiguration
    checkjvm?: (context: coc.ExtensionContext, jvm: JVM) => any
    preferJdk?: boolean
    highlightCodeLensSettingKey?: string
    explodedLsJarData?: ExplodedLsJarData
    vmArgs?: string[]
}

export interface ExplodedLsJarData {
    lsLocation: string
    mainClass: string
    configFileName?: string
}

type JavaOptions = {
    heap?: string
    home?: string
    vmargs?: string[]
}

function getUserDefinedJvmHeap(wsOpts: coc.WorkspaceConfiguration, dflt: string): string {
    if (!wsOpts) {
        return dflt
    }
    const javaOptions: JavaOptions | undefined = wsOpts.get("java")
    return javaOptions?.heap || dflt
}

function isCheckingJVM(wsOpts: coc.WorkspaceConfiguration): boolean {
    if (!wsOpts) {
        return true
    }
    return wsOpts.get("checkJVM") as boolean
}

function getUserDefinedJvmArgs(wsOpts: coc.WorkspaceConfiguration): string[] {
    const dflt = []
    if (!wsOpts) {
        return dflt
    }
    let javaOptions: JavaOptions | undefined = wsOpts.get("java")
    return javaOptions?.vmargs ? [...javaOptions.vmargs] : dflt
}

function getUserDefinedLsDirectory(options: ActivatorOptions, context: coc.ExtensionContext): string {
    let location: string | undefined = options.workspaceOptions.get("directory")
    location = !location || !FS.existsSync(location) ? context.extensionPath : location

    if (location) {
        location = coc.workspace.expand(location)
        if (!FS.existsSync(location)) {
            logToSpringBootOutput(
                `Spring boot can not start, invalid or non existent path was detected ${location}`,
            )
            coc.window.showErrorMessage(`Spring boot not found, check springboot output`)
            abort()
        }
    } else {
        coc.window.showErrorMessage(`Spring boot binaries directory could not be resolved at all`)
        abort()
    }
    return location
}

function getSpringUserDefinedJavaHome(wsOpts: coc.WorkspaceConfiguration, log: coc.OutputChannel): string | undefined {
    let javaHome: string | undefined = undefined
    if (wsOpts) {
        let javaOptions: JavaOptions | undefined = wsOpts.get("java")
        javaHome = javaOptions?.home
    }
    if (!javaHome) {
        log.appendLine('"spring-boot.ls.java.home" setting not specified or empty value')
        javaHome = undefined
    } else if (!FS.existsSync(javaHome)) {
        log.appendLine('"spring-boot.ls.java.home" points to folder that does NOT exist: ' + javaHome)
        javaHome = undefined
    } else {
        log.appendLine('Trying to use "spring-boot.ls.java.home" value: ' + javaHome)
    }
    return javaHome
}

function getJdtUserDefinedJavaHome(log: coc.OutputChannel): string | undefined {
    let javaHome: string | undefined = coc.workspace.getConfiguration('java')?.get('home')
    if (!javaHome) {
        log.appendLine('"java.home" setting not specified or empty value')
        javaHome = undefined
    } else if (!FS.existsSync(javaHome)) {
        log.appendLine('"java.home" points to folder that does NOT exist: ' + javaHome)
        javaHome = undefined
    } else {
        log.appendLine('Trying to use "java.home" value: ' + javaHome)
    }
    return javaHome
}

function findJdtEmbeddedJRE(): string | undefined {
    const javaExtension = getJavaExtension()
    if (javaExtension) {
        const jreHome = Path.resolve(javaExtension.extensionPath, 'jre')
        if (FS.existsSync(jreHome) && FS.statSync(jreHome).isDirectory()) {
            const candidates = FS.readdirSync(jreHome)
            for (const candidate of candidates) {
                if (FS.existsSync(Path.join(jreHome, candidate, "bin"))) {
                    return Path.join(jreHome, candidate)
                }
            }
        }
    }
    return undefined
}

export async function activate(options: ActivatorOptions, context: coc.ExtensionContext): Promise<LanguageClient> {
    let location: string = getUserDefinedLsDirectory(options, context)

    if (options.CONNECT_TO_LS) {
        await coc.window.showInformationMessage("Connecting to spring boot language server")
        return await connectToLS(location, options)
    } else {
        const clientOptions = options.clientOptions
        clientOptions.outputChannel = initLogOutput(context)

        let finder = options.preferJdk ? findJdk : findJvm
        let home: string | undefined = getSpringUserDefinedJavaHome(options.workspaceOptions, clientOptions?.outputChannel)
            || findJdtEmbeddedJRE()
            || getJdtUserDefinedJavaHome(clientOptions?.outputChannel)
        home = home?.length == 0 ? undefined : home

        let jvm: JVM | undefined
        try {
            jvm = await finder(home as string, msg => clientOptions?.outputChannel?.appendLine(msg)) as JVM
        } catch (error) {
            coc.window.showErrorMessage("Error while trying to find jvm: " + error)
            await Promise.reject(error)
        }
        if (!jvm) {
            coc.window.showErrorMessage("Couldn't locate java in $JAVA_HOME or $PATH")
            return Promise.reject(new Error())
        }
        let javaExecutablePath = jvm.getJavaExecutable()
        clientOptions?.outputChannel?.appendLine("Found java executable: " + javaExecutablePath)
        clientOptions?.outputChannel?.appendLine("isJavaEightOrHigher => true")
        if (process.env['SPRING_LS_USE_SOCKET']) {
            return setupLanguageClient(location, createServerOptionsForPortComm(location, options, context, jvm), options)
        } else {
            return setupLanguageClient(location, createServerOptions(location, options, context, jvm), options)
        }
    }
}

function createServerOptions(location: string, options: ActivatorOptions, context: coc.ExtensionContext, jvm: JVM, port?: number): Executable {
    const executable: Executable = Object.create(null)
    const execOptions: ExecutableOptions = Object.create(null)
    execOptions.env = Object.assign(process.env)
    executable.options = execOptions
    executable.command = jvm.getJavaExecutable()
    const vmArgs = prepareJvmArgs(location, options, context, jvm, port)
    addCpAndLauncherToJvmArgs(location, vmArgs, options, context)
    executable.args = vmArgs
    return executable
}

function createServerOptionsForPortComm(location: string, options: ActivatorOptions, context: coc.ExtensionContext, jvm: JVM): ServerOptions {

    return () =>
        new Promise((resolve) => {
            PortFinder.getPort((_, port) => {
                Net.createServer(socket => {
                    options.clientOptions?.outputChannel?.appendLine('Child process connected on port ' + port)
                    resolve({
                        reader: socket,
                        writer: socket
                    })
                }).listen(port, () => {
                    let processLaunchoptions = {
                        cwd: coc.workspace.root
                    }
                    const args = prepareJvmArgs(location, options, context, jvm, port)
                    const launcher = findServerJar(Path.resolve(location, 'language-server'))
                    if (!launcher) {
                        logToSpringBootOutput(`Unable to locate language server jars under working directory ${location}, falling back to exploded jar resolution`)
                        options.explodedLsJarData = {
                            lsLocation: 'language-server',
                            configFileName: 'application.properties',
                            mainClass: 'org.springframework.ide.vscode.boot.app.BootLanguageServerBootApp',
                        }
                        const explodedLsJarData = options.explodedLsJarData
                        const lsRoot = Path.resolve(location, explodedLsJarData.lsLocation)

                        const classpath: string[] = []
                        classpath.push(Path.resolve(lsRoot, 'BOOT-INF/classes'))
                        classpath.push(`${Path.resolve(lsRoot, 'BOOT-INF/lib')}${Path.sep}*`)

                        jvm.mainClassLaunch(explodedLsJarData.mainClass, classpath, args, processLaunchoptions)
                    } else {
                        jvm.jarLaunch(launcher, args, processLaunchoptions)
                    }
                })
            })
        })
}

function prepareJvmArgs(location: string, options: ActivatorOptions, context: coc.ExtensionContext, jvm: JVM, port?: number): string[] {
    const DEBUG = options.DEBUG
    const jvmHeap = getUserDefinedJvmHeap(options.workspaceOptions, options.jvmHeap)
    const jvmArgs = getUserDefinedJvmArgs(options.workspaceOptions)
    if (Array.isArray(options.vmArgs)) {
        jvmArgs.push(...options.vmArgs)
    }

    let logfile: string = options.workspaceOptions.get("logfile") || "/dev/null"
    //The logfile = '/dev/null' is handled specifically by the language server process
    options.clientOptions?.outputChannel?.appendLine('Redirecting server logs to ' + logfile)
    const args = [
        '-Dsts.lsp.client=vscode',
        '-Dsts.log.file=' + logfile,
        '-XX:TieredStopAtLevel=1'
    ]
    if (port && port > 0) {
        args.push('-Dspring.lsp.client-port=' + port)
        args.push('-Dserver.port=' + port)
    }
    if (isCheckingJVM(options.workspaceOptions) && options.checkjvm) {
        options.checkjvm(context, jvm)
    }
    if (jvmHeap && !hasHeapArg(jvmArgs)) {
        args.unshift("-Xmx" + jvmHeap)
    }
    if (jvmArgs) {
        args.unshift(...jvmArgs)
    }
    if (DEBUG) {
        args.unshift(DEBUG_ARG)
    }
    // Below is to fix: https://github.com/spring-projects/sts4/issues/811
    if (!hasVmArg(LOG_RESOLVE_VM_ARG_PREFIX, args)) {
        args.push(`${LOG_RESOLVE_VM_ARG_PREFIX}off`)
    }

    if (options.explodedLsJarData) {
        const explodedLsJarData = options.explodedLsJarData
        const lsRoot = Path.resolve(location, explodedLsJarData.lsLocation)
        if (explodedLsJarData.configFileName) {
            args.push(`-Dspring.config.location=file:${Path.resolve(lsRoot, `BOOT-INF/classes/${explodedLsJarData.configFileName}`)}`)
        }
    }
    return args
}

function addCpAndLauncherToJvmArgs(location: string, args: string[], options: ActivatorOptions, context: coc.ExtensionContext) {
    const launcher = findServerJar(Path.resolve(location, 'language-server'))
    if (!launcher) {
        logToSpringBootOutput(`Unable to locate language server jars under working directory ${location}, falling back to exploded jar resolution`)
        options.explodedLsJarData = {
            lsLocation: 'language-server',
            configFileName: 'application.properties',
            mainClass: 'org.springframework.ide.vscode.boot.app.BootLanguageServerBootApp',
        }
        const explodedLsJarData = options.explodedLsJarData
        const lsRoot = Path.resolve(location, explodedLsJarData.lsLocation)

        const classpath: string[] = []
        classpath.push(Path.resolve(lsRoot, 'BOOT-INF/classes'))
        classpath.push(`${Path.resolve(lsRoot, 'BOOT-INF/lib')}${Path.sep}*`)

        args.unshift(classpath.join(Path.delimiter))
        args.unshift('-cp')
        args.push(explodedLsJarData.mainClass)
    } else {
        args.push('-jar')
        args.push(launcher)
    }
}

function hasHeapArg(vmargs?: string[]): boolean {
    return hasVmArg('-Xmx', vmargs)
}

function hasVmArg(argPrefix: string, vmargs?: string[]): boolean {
    if (vmargs) {
        return vmargs.some(a => a.startsWith(argPrefix))
    }
    return false
}

function findServerJar(jarsDir: any): string | undefined {
    let serverJars = FS.readdirSync(jarsDir).filter(jar =>
        jar.indexOf('language-server') >= 0 &&
        jar.endsWith(".jar")
    )
    if (serverJars.length == 0) {
        return undefined
    }
    if (serverJars.length > 1) {
        throw new Error("Multiple server jars found in " + jarsDir)
    }
    return Path.resolve(jarsDir, serverJars[0])
}

function connectToLS(location: string, options: ActivatorOptions): Promise<LanguageClient> {
    let connectionInfo = {
        port: 5007
    }

    let serverOptions = () => {
        let socket = Net.connect(connectionInfo)
        let result: StreamInfo = {
            writer: socket,
            reader: socket
        }
        return Promise.resolve(result)
    }

    console.log(`Connecting to spring boot language server on port ${connectionInfo.port}`)
    return setupLanguageClient(location, serverOptions, options)
}

function setupLanguageClient(location: string, createServer: ServerOptions, options: ActivatorOptions): Promise<LanguageClient> {
    let client = new LanguageClient(options.extensionId, options.extensionId, createServer, options.clientOptions)
    logToSpringBootOutput(`Registered spring boot language server resources for ${location}`)

    if (options.TRACE) {
        client.trace = coc.Trace.Verbose
    }

    let moveCursorRequest = new coc.RequestType<MoveCursorParams, MoveCursorResponse, void>("sts/moveCursor")
    client.onRequest(moveCursorRequest, (params: MoveCursorParams) => {
        for (let editor of coc.window.visibleTextEditors) {
            if (editor.document.uri.toString() == params.uri) {
                // let cursor = p2c.asPosition(params.position);
                // let selection: coc.Selection = new coc.Selection(cursor, cursor);
                // editor.selections = [selection];
            }
        }
        return { applied: true }
    })
    return Promise.resolve(client)
}

interface MoveCursorParams {
    uri: string
    position: Position
}

interface MoveCursorResponse {
    applied: boolean
}

export interface ListenableSetting<T> {
    value: T
    onDidChangeValue: coc.Event<void>
}

export class ListenablePreferenceSetting<T> implements ListenableSetting<T> {

    private _onDidChangeValue = new Emitter<void>();
    private _disposable: Disposable

    constructor(private section: string) {
        this._disposable = coc.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this.section)) {
                this._onDidChangeValue.fire()
            }
        })
    }

    get value(): T {
        return coc.workspace.getConfiguration().get(this.section) as T
    }

    get onDidChangeValue(): Event<void> {
        return this._onDidChangeValue.event
    }

    dispose(): any {
        return this._disposable.dispose()
    }

}
