import * as path from 'path'
import * as fs from 'fs'
import { spawn } from 'child_process'
import {
    CodeAction,
    CodeLens,
    Command,
    ExtensionContext,
    FileChangeType,
    LanguageClient,
    Middleware,
    OutputChannel,
    Uri,
    commands,
    window,
} from 'coc.nvim'

const MAVEN_GOAL_COMMAND = 'springboot.maven.goal'
const GRADLE_BUILD_COMMAND = 'springboot.gradle.build'

/**
 * The language server emits the command ids of the vscode maven and gradle extensions (e.g. for the
 * refresh aot metadata code lens), these are mapped to the build commands provided by this extension
 */
const COMMAND_MAPPINGS: { [id: string]: string } = {
    'maven.goal.custom': MAVEN_GOAL_COMMAND,
    'gradle.runBuild': GRADLE_BUILD_COMMAND,
}

interface BuildOptions {
    refreshJavaProject?: boolean
}

let buildOutput: OutputChannel | undefined
let languageClient: LanguageClient | undefined
let extensionContext: ExtensionContext | undefined

// folders where the spring boot plugins generate the spring data aot repository metadata
const AOT_METADATA_FOLDERS = [
    path.join('target', 'spring-aot', 'main', 'resources'),
    path.join('build', 'generated', 'aotResources'),
]

function getBuildOutput(): OutputChannel {
    if (!buildOutput) {
        buildOutput = window.createOutputChannel('SpringBoot Build')
        extensionContext?.subscriptions.push(buildOutput)
    }
    return buildOutput
}

function findWrapper(startDir: string, name: string): string | undefined {
    for (let dir = startDir; dir !== path.dirname(dir); dir = path.dirname(dir)) {
        const wrapper = path.join(dir, name)
        if (fs.existsSync(wrapper)) {
            return wrapper
        }
    }
    return undefined
}

function collectJsonFiles(dir: string, since: number, result: string[] = []): string[] {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            collectJsonFiles(file, since, result)
        } else if (entry.name.endsWith('.json') && fs.statSync(file).mtimeMs >= since) {
            result.push(file)
        }
    }
    return result
}

/**
 * The generated aot metadata often lives in folders the file watcher ignores (e.g. target/ or build/ in the
 * watchman config), make sure the language server learns about the regenerated metadata after the build
 */
function notifyGeneratedMetadata(projectDir: string, since: number) {
    const files = AOT_METADATA_FOLDERS.flatMap(folder => collectJsonFiles(path.join(projectDir, folder), since))
    if (languageClient && files.length > 0) {
        languageClient.sendNotification('workspace/didChangeWatchedFiles', {
            changes: files.map(file => ({ uri: Uri.file(file).toString(), type: FileChangeType.Changed }))
        })
    }
}

async function runBuild(title: string, executable: string, args: string[], cwd: string, env: { [key: string]: string }): Promise<boolean> {
    const output = getBuildOutput()
    output.appendLine(`> ${executable} ${args.join(' ')} (in ${cwd})`)
    const success = await window.withProgress({ title, cancellable: true }, (_progress, token) => new Promise<boolean>(resolve => {
        const child = spawn(executable, args, { cwd, env: Object.assign({}, process.env, env || {}) })
        child.stdout.on('data', data => output.append(data.toString()))
        child.stderr.on('data', data => output.append(data.toString()))
        child.on('error', err => {
            output.appendLine(`Failed to run ${executable}: ${err.message}`)
            resolve(false)
        })
        child.on('close', code => {
            output.appendLine(`< exited with code ${code}`)
            resolve(code === 0)
        })
        token.onCancellationRequested(() => child.kill())
    }))
    if (success) {
        window.showInformationMessage(`${title} finished successfully`)
    } else {
        window.showErrorMessage(`${title} failed, check the 'SpringBoot Build' output for details`)
        output.show(true)
    }
    return success
}

async function runMavenGoal(buildFile: string, goal: string, env?: { [key: string]: string }): Promise<boolean> {
    const projectDir = path.dirname(buildFile)
    const executable = findWrapper(projectDir, 'mvnw') || 'mvn'
    const args = ['-f', buildFile, ...goal.split(/\s+/).filter(g => g.length > 0)]
    const started = Date.now()
    const success = await runBuild(`Maven ${goal}`, executable, args, projectDir, env)
    if (success) {
        notifyGeneratedMetadata(projectDir, started)
    }
    return success
}

async function runGradleBuild(buildFile: string, command: string, env?: { [key: string]: string }, options?: BuildOptions): Promise<boolean> {
    const projectDir = path.dirname(buildFile)
    const executable = findWrapper(projectDir, 'gradlew') || 'gradle'
    const args = ['-p', projectDir, ...command.split(/\s+/).filter(c => c.length > 0)]
    const started = Date.now()
    const success = await runBuild(`Gradle ${command}`, executable, args, projectDir, env)
    if (success) {
        notifyGeneratedMetadata(projectDir, started)
    }
    if (success && options?.refreshJavaProject) {
        await commands.executeCommand('java.projectConfiguration.update', Uri.file(buildFile))
    }
    return success
}

function remapCommand(command: Command | undefined): void {
    if (command && COMMAND_MAPPINGS[command.command]) {
        command.command = COMMAND_MAPPINGS[command.command]
    }
}

function remapCodeLenses(lenses: CodeLens[] | null | undefined): CodeLens[] | null | undefined {
    lenses?.forEach(lens => remapCommand(lens.command))
    return lenses
}

function remapCodeActions(actions: (Command | CodeAction)[] | null | undefined): (Command | CodeAction)[] | null | undefined {
    actions?.forEach(action => remapCommand(Command.is(action) ? action : action.command))
    return actions
}

export const buildCommandsMiddleware: Middleware = {
    provideCodeLenses: async (document, token, next) => remapCodeLenses(await next(document, token)),
    resolveCodeLens: async (codeLens, token, next) => {
        const resolved = await next(codeLens, token)
        remapCommand(resolved?.command)
        return resolved
    },
    provideCodeActions: async (document, range, context, token, next) => remapCodeActions(await next(document, range, context, token)),
    resolveCodeAction: async (item, token, next) => {
        const resolved = await next(item, token)
        remapCommand(resolved?.command)
        return resolved
    },
}

export function registerBuildCommands(client: LanguageClient, context: ExtensionContext) {
    languageClient = client
    extensionContext = context
    context.subscriptions.push(
        commands.registerCommand(MAVEN_GOAL_COMMAND, runMavenGoal, null, true),
        commands.registerCommand(GRADLE_BUILD_COMMAND, runGradleBuild, null, true),
    )
}
