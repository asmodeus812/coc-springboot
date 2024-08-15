"use strict"

import * as coc from "coc.nvim"
let springBootOutput: coc.OutputChannel

export function initLogOutput(context: coc.ExtensionContext): coc.OutputChannel {
    springBootOutput = coc.window.createOutputChannel("SpringBoot")
    context.subscriptions.push(springBootOutput)
    return springBootOutput;
}

export function logToSpringBootOutput(message: string) {
    if (springBootOutput) {
        springBootOutput.appendLine(message)
    }
}

export function getLogOutput() {
    return springBootOutput
}

export function showLogOutput() {
    getLogOutput()?.show()
}
