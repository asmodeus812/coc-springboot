'use strict'
import {
    commands,
    window,
    workspace,
    ExtensionContext,
    Uri
} from 'coc.nvim'

import * as commons from './utils'
import { ApiManager } from "./apiManager"
import { ExtensionAPI } from "./api"
import { registerJavaDataService, registerClasspathService } from "./utils"
import { startPropertiesConversionSupport } from "./convert-props-yaml"

const PROPERTIES_LANGUAGE_ID = "spring-boot-properties"
const YAML_LANGUAGE_ID = "spring-boot-properties-yaml"
const JAVA_LANGUAGE_ID = "java"
const XML_LANGUAGE_ID = "xml"
const FACTORIES_LANGUAGE_ID = "spring-factories"
const JPA_QUERY_PROPERTIES_LANGUAGE_ID = "jpa-query-properties"

const STOP_ASKING = "Stop Asking"

/** Called when extension is activated */
export function activate(context: ExtensionContext): Thenable<ExtensionAPI> {
    let options: commons.ActivatorOptions = {
        explodedLsJarData: {
            lsLocation: 'language-server',
            configFileName: 'application.properties',
            mainClass: 'org.springframework.ide.vscode.boot.app.BootLanguageServerBootApp',
        },
        extensionId: 'springboot',
        CONNECT_TO_LS: false,
        jvmHeap: '1024m',
        preferJdk: true,
        DEBUG: false,
        vmArgs: [],
        checkjvm: (context: ExtensionContext, jvm: commons.JVM) => {
            let version = jvm.getMajorVersion()
            if (version < 17) {
                throw Error(`Spring Tools Language Server requires Java 17 or higher to be launched. Current Java version is ${version}`)
            }

            if (!jvm.isJdk()) {
                window.showWarningMessage(
                    'JAVA_HOME or PATH environment variable seems to point to a JRE. A JDK is required, hence Boot Hints are unavailable.',
                    STOP_ASKING).then(selection => {
                        if (selection === STOP_ASKING) {
                            options.workspaceOptions.update('checkJVM', false)
                        }
                    }
                    )
            }
        },
        workspaceOptions: workspace.getConfiguration("spring-boot.ls"),
        clientOptions: {
            markdown: {
                isTrusted: true
            },
            documentSelector: [
                {
                    language: PROPERTIES_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: YAML_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: FACTORIES_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: JPA_QUERY_PROPERTIES_LANGUAGE_ID,
                    scheme: 'file'
                },
                {
                    language: XML_LANGUAGE_ID,
                    scheme: 'file'
                }
                // {
                //     language: JAVA_LANGUAGE_ID,
                //     scheme: 'file'
                // },
                // {
                //     language: JAVA_LANGUAGE_ID,
                //     scheme: 'jdt'
                // },
            ],
            synchronize: {
                configurationSection: ['boot-java', 'spring-boot', 'http']
            },
            initializationOptions: () => ({
                workspaceFolders: workspace.workspaceFolders ? workspace.workspaceFolders.map(f => f.uri.toString()) : null,
                // Do not enable JDT classpath listeners at the startup - classpath service would enable it later if needed based on the Java extension mode
                // Classpath service registration requires commands to be registered and Boot LS needs to register classpath 
                // listeners when client has callbacks for STS4 extension java related messages registered via JDT classpath and Data Service registration
                enableJdtClasspath: false
            })
        },
        highlightCodeLensSettingKey: 'boot-java.highlight-codelens.on'
    }

    // Register launch config contributior to java debug launch to be able to connect to JMX
    // context.subscriptions.push(startDebugSupport());

    return commons.activate(options, context).then(client => {
        commands.registerCommand('vscode-spring-boot.ls.start', () => client.start().then(() => {
            // Boot LS is fully started
            registerClasspathService(client)
            registerJavaDataService(client)

            // Force classpath listener to be enabled. Boot LS can only be launched if 
            // classpath is available and there Spring-Boot on the classpath somewhere.
            commands.executeCommand('sts.vscode-spring-boot.enableClasspathListening', true)

            // Register TestJars launch support
            // context.subscriptions.push(startTestJarSupport());
        }))

        commands.registerCommand('vscode-spring-boot.ls.stop', () => client.stop())
        // liveHoverUi.activate(client, options, context);
        // rewrite.activate(client, options, context);
        startPropertiesConversionSupport(context)
        registerMiscCommands(context)

        return new ApiManager(client).api
    })
}

function registerMiscCommands(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('vscode-spring-boot.spring.modulith.metadata.refresh', async () => {
            const modulithProjects: any = await commands.executeCommand('sts/modulith/projects')
            const projectNames: any[] = Object.keys(modulithProjects)
            if (projectNames.length === 0) {
                window.showErrorMessage('No Spring Modulith projects found')
            } else {
                const projectName = projectNames.length === 1 ? projectNames[0] : await window.showQuickPick(
                    projectNames,
                    { placeholder: "Select the target project." },
                )
                commands.executeCommand('sts/modulith/metadata/refresh', modulithProjects[projectName])
            }
        }),

        commands.registerCommand('vscode-spring-boot.open.url', (openUrl) => {
            const openWithExternalBrowser = workspace.getConfiguration("spring.tools").get("openWith") === "external"
            const browserCommand = openWithExternalBrowser ? "vscode.open" : "simpleBrowser.api.open"
            return commands.executeCommand(browserCommand, Uri.parse(openUrl))
        }),
    )
}
