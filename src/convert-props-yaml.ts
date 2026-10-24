import * as path from "path";
import {existsSync} from "fs";
import {ExtensionContext, Uri, commands, window, workspace} from "coc.nvim";

export function startPropertiesConversionSupport(extension: ExtensionContext) {
    extension.subscriptions.push(
        commands.registerCommand('springboot.props-to-yaml', async (target?: string | Uri) => {
            let uri = toUri(target);
            if (!uri && window.activeTextEditor) {
                const activeUri = Uri.parse(window.activeTextEditor.document.uri);
                if (".properties" === path.extname(activeUri.path)) {
                    uri = activeUri;
                }
            }
            if (!uri) {
                window.showErrorMessage("No '.properties' file selected");
                return;
            }
            return await commands.executeCommand("sts/boot/props-to-yaml", uri.toString(), Uri.file(getTargetFile(uri.fsPath, "yml")).toString(), shouldReplace());
        }),

        commands.registerCommand('springboot.yaml-to-props', async (target?: string | Uri) => {
            let uri = toUri(target);
            if (!uri && window.activeTextEditor) {
                const activeUri = Uri.parse(window.activeTextEditor.document.uri);
                const ext = path.extname(activeUri.path)
                if (".yml" === ext || ".yaml" === ext) {
                    uri = activeUri;
                }
            }
            if (!uri) {
                window.showErrorMessage("No '.yaml' file selected");
                return;
            }
            return await commands.executeCommand("sts/boot/yaml-to-props", uri.toString(), Uri.file(getTargetFile(uri.fsPath, "properties")).toString(), shouldReplace());
        })
    );
}

function toUri(target?: string | Uri): Uri | undefined {
    if (typeof target === 'string') {
        return target.includes('://') ? Uri.parse(target) : Uri.file(target);
    }
    return target;
}

function getTargetFile(sourcePath: string, ext: string): string {
    const dir = path.dirname(sourcePath);
    const fileName = path.basename(sourcePath);
    const filenameNoExt = path.basename(sourcePath).substring(0, fileName.length - path.extname(fileName).length);
    let targetPath = path.join(dir, `${filenameNoExt}.${ext}`);
    for (let i = 1; i < Number.MAX_SAFE_INTEGER && existsSync(targetPath); i++) {
        targetPath = path.join(dir, `${filenameNoExt}-${i}.${ext}`)
    }
    return targetPath;
}

function shouldReplace(): boolean {
    return workspace.getConfiguration("spring.tools.properties").get("replace-converted-file") as boolean
}

