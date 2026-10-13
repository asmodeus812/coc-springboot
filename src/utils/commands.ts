'use strict'
import * as coc from 'coc.nvim'

/**
 * Commands which the spring boot language server embeds in hovers, code lenses and code actions, and
 * which are expected to be provided by the client, regardless of the client specific naming convention
 */
export function registerCommands(context: coc.ExtensionContext) {
    context.subscriptions.push(
        coc.commands.registerCommand("sts.open.url", openUrl, null, true),
        coc.commands.registerCommand("vscode-spring-boot.open.url", openUrl, null, true),
        coc.commands.registerCommand("springboot.open.url", openUrl),
        coc.commands.registerCommand("sts.showHoverAtPosition", showHoverAtPosition, null, true),
        coc.commands.registerCommand("boot-ls.client.set-configuration", setConfiguration, null, true),
    )
}

async function openUrl(url: string | coc.Uri) {
    if (url) {
        const target = url.toString()
        coc.window.showInformationMessage(`Opening ${target} with browser`)
        await coc.workspace.nvim.call('coc#ui#open_url', [target])
    } else {
        coc.window.showErrorMessage('No url was provided to open in the browser')
    }
}

export async function moveCursor(uri: string, position: coc.Position): Promise<void> {
    const target = coc.Uri.parse(uri).toString()
    for (const editor of coc.window.visibleTextEditors) {
        if (coc.Uri.parse(editor.document.uri).toString() === target) {
            const command = `call coc#cursor#move_to(${position.line}, ${position.character})`
            await coc.workspace.nvim.call('win_execute', [editor.winid, command])
        }
    }
}

export async function setConfiguration(key: string, value: any) {
    const lastDot = key.lastIndexOf('.')
    const section = key.substring(0, lastDot)
    const settingName = key.substring(lastDot + 1)
    await coc.workspace.getConfiguration(section).update(settingName, value, coc.ConfigurationTarget.Global)
}

async function showHoverAtPosition(position?: coc.Position) {
    const editor = coc.window.activeTextEditor
    if (editor && position) {
        await moveCursor(editor.document.uri, position)
    }
    await coc.workspace.nvim.call('CocActionAsync', ['doHover'])
}
