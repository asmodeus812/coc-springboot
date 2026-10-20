import { ExtensionContext, LanguageClient, QuickPickItem, State, commands, window } from 'coc.nvim'

export const CONNECT_CMD = "sts/livedata/connect"
export const DISCONNECT_CMD = "sts/livedata/disconnect"
const REFRESH_CMD = "sts/livedata/refresh"
const LIST_CMD = "sts/livedata/listProcesses"

export interface ProcessCommandInfo {
    processKey: string
    label: string
    action: string
    projectName: string
}

export interface BootAppQuickPick extends QuickPickItem {
    commandInfo: ProcessCommandInfo
}

function actionLabel(action: string): string {
    switch (action) {
        case CONNECT_CMD:
            return "Show"
        case REFRESH_CMD:
            return "Refresh"
        case DISCONNECT_CMD:
            return "Hide"
        default:
            return "Execute"
    }
}

export async function listRunningProcesses(): Promise<ProcessCommandInfo[]> {
    const processes: ProcessCommandInfo[] = await window.withProgress({
        title: 'Searching for running Spring Boot Apps...',
        cancellable: false
    }, () => commands.executeCommand(LIST_CMD))
    return Array.isArray(processes) ? processes : []
}

async function liveHoverConnectHandler() {
    const processData = await listRunningProcesses()
    const items: BootAppQuickPick[] = processData.map(p => ({
        label: `${actionLabel(p.action)} Live Data from: ${p.label}`,
        description: p.projectName,
        commandInfo: p
    }))

    if (!items.length) {
        window.showInformationMessage("No running Spring Boot Apps found")
    } else {
        const chosen = await window.showQuickPick(items, {
            title: "Select action for running Spring Boot App",
            matchOnDescription: true
        })
        if (chosen) {
            await commands.executeCommand(chosen.commandInfo.action, chosen.commandInfo)
        }
    }
}

export function whenStarted(client: LanguageClient, handler: () => Promise<void>) {
    return () => {
        if (client.getPublicState() === State.Running) {
            return handler()
        } else {
            window.showErrorMessage("No Spring Boot project found. Action is only available for Spring Boot Projects")
        }
    }
}

export function activate(client: LanguageClient, context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('springboot.live-hover.connect', whenStarted(client, liveHoverConnectHandler)),
    )
}
