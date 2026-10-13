import { ExtensionContext, LanguageClient, QuickPickItem, commands, window } from 'coc.nvim'
import { LiveProcessLogLevelUpdatedNotification, LiveProcessUpdatedLogLevel } from './notification'
import { BootAppQuickPick, CONNECT_CMD, DISCONNECT_CMD, ProcessCommandInfo, listRunningProcesses, whenStarted } from './live-hover-connect-ui'

interface Logger {
    configuredLevel: string
    effectiveLevel: string
}

interface Loggers {
    [propName: string]: Logger
}

interface LoggersData {
    levels: string[]
    loggers: Loggers
}

interface ProcessLoggersData {
    loggers: LoggersData
    processID: string
    processName: string
    processType: number
}

interface LoggerQuickPick extends QuickPickItem {
    packageName: string
    effectiveLevel: string
}

async function setLogLevelHandler() {
    const processInfo = await selectRunningProcess()
    if (processInfo) {
        let loggers: ProcessLoggersData | undefined
        try {
            loggers = await window.withProgress({
                title: `Fetching Loggers Data for process ${processInfo.processKey}`,
                cancellable: false
            }, () => commands.executeCommand('sts/livedata/getLoggers', processInfo, { "endpoint": "loggers" }))
        } catch (_error) {
            window.showErrorMessage(`Failed to fetch loggers for the process ${processInfo.processKey}`)
        }
        if (loggers) {
            await displayLoggers(loggers, processInfo.processKey)
        }
    }
}

async function selectRunningProcess(): Promise<ProcessCommandInfo | undefined> {
    // only processes which can be (or are already) connected to provide the actuator loggers endpoint
    const items: BootAppQuickPick[] = (await listRunningProcesses())
        .filter(p => CONNECT_CMD === p.action || DISCONNECT_CMD === p.action)
        .map(p => ({ label: p.label, description: p.projectName, commandInfo: p }))

    if (!items.length) {
        window.showInformationMessage("No running Spring Boot Apps found")
        return undefined
    }
    const chosen = items.length === 1 ? items[0] : await window.showQuickPick(items, { title: "Select running Spring Boot App" })
    return chosen?.commandInfo
}

async function displayLoggers(processLoggersData: ProcessLoggersData, processKey: string) {
    const loggersData = processLoggersData.loggers
    const items: LoggerQuickPick[] = Object.keys(loggersData?.loggers || {}).map(packageName => {
        const effectiveLevel = loggersData.loggers[packageName].effectiveLevel
        return {
            label: `${packageName} (${effectiveLevel})`,
            packageName,
            effectiveLevel
        }
    })

    if (!items.length) {
        window.showWarningMessage(`No loggers were reported by the process ${processKey}`)
    } else {
        const chosenPackage = await window.showQuickPick(items, { title: "Select Logger" })
        if (chosenPackage) {
            const chosenLogLevel = await window.showQuickPick(loggersData.levels, { title: `Select Level for ${chosenPackage.packageName}` })
            if (chosenLogLevel) {
                await commands.executeCommand('sts/livedata/configure/logLevel', { "processKey": processKey }, chosenPackage, { "configuredLevel": chosenLogLevel })
            }
        }
    }
}

function logLevelUpdated(process: LiveProcessUpdatedLogLevel) {
    window.showInformationMessage(`The Log level for ${process.packageName} has been updated from ${process.effectiveLevel} to ${process.configuredLevel}`)
}

export function activate(client: LanguageClient, context: ExtensionContext) {
    client.onNotification(LiveProcessLogLevelUpdatedNotification.type, logLevelUpdated)
    context.subscriptions.push(
        commands.registerCommand('springboot.set.log-levels', whenStarted(client, setLogLevelHandler))
    )
}
