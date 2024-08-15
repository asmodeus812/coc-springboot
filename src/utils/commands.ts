'use strict';

import * as coc from 'coc.nvim';
// import {Position} from 'vscode-languageclient';

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
        // const editor = coc.window.activeTextEditor;
        // const vsPosition = new coc.Position(position.line, position.character);
        // editor.selection = new coc.Selection(vsPosition, vsPosition);
        coc.commands.executeCommand('editor.action.showHover');
    });
}
