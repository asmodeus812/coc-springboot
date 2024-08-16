'use strict';
import * as coc from 'coc.nvim';

export function registerCommands(context: coc.ExtensionContext) {
    registerOpenUrl(context, "sts.open.url");
    registerShowHoverAtPosition(context, "sts.showHoverAtPosition");
}

function registerOpenUrl(context: coc.ExtensionContext, commandId: string) {
    context.subscriptions.push(coc.commands.registerCommand(commandId, (url) => {
        coc.commands.executeCommand('vscode.open', coc.Uri.parse(url))
    }));
}

function registerShowHoverAtPosition(context: coc.ExtensionContext, commandId: string) {
    coc.commands.registerCommand(commandId, () => {
        coc.commands.executeCommand('editor.action.showHover');
    });
}
