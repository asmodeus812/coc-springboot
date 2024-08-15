'use strict';

import * as coc from 'coc.nvim';
const JDT_SERVER_STANDARD_MODE = 'Standard'
const CMD_STS_ENABLE_CLASSPATH_LISTENER = 'sts.vscode-spring-boot.enableClasspathListening';

export function getJavaExtension(): coc.Extension<any> | undefined {
    const java = coc.extensions.getExtensionById("coc-java")
    if (!java || java == null || java === undefined) {
        return coc.extensions.getExtensionById("coc-java-dev")
    }
    return java
}

export function registerClasspathService(client: coc.LanguageClient): void {
    const javaExt = getJavaExtension()
    const javaApi = javaExt?.exports;

    let addRequest = new coc.RequestType<ClasspathListenerParams, ClasspathListenerResponse, void>("sts/addClasspathListener");
    client.onRequest(addRequest, async (params: ClasspathListenerParams) => {
        if (javaApi?.serverMode === 'LightWeight') {
            throw new Error('Classpath listener not supported while Java Language Server is in LightWeight mode');
        }
        return await coc.commands.executeCommand("java.execute.workspaceCommand", "sts.java.addClasspathListener", params.callbackCommandId);
    });

    let removeRequest = new coc.RequestType<ClasspathListenerParams, ClasspathListenerResponse, void>("sts/removeClasspathListener");
    client.onRequest(removeRequest, async (params: ClasspathListenerParams) => {
        return await coc.commands.executeCommand("java.execute.workspaceCommand", "sts.java.removeClasspathListener", params.callbackCommandId);
    });

    if (javaApi) {
        coc.commands.executeCommand(CMD_STS_ENABLE_CLASSPATH_LISTENER, javaApi.serverMode === JDT_SERVER_STANDARD_MODE);
        javaApi.onDidServerModeChange(() => coc.commands.executeCommand(CMD_STS_ENABLE_CLASSPATH_LISTENER, javaApi.serverMode === JDT_SERVER_STANDARD_MODE));
    }
}

interface ClasspathListenerParams {
    callbackCommandId: string
}

interface ClasspathListenerResponse {
}
