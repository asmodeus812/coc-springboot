import { ActivatorOptions } from "./utils/launch-util"
import * as coc from 'coc.nvim'
import * as path from "path"

const BOOT_UPGRADE = 'BOOT_UPGRADE'
const OTHER_REFACTORINGS = 'NON_BOOT_UPGRADE'
let quickPick: coc.QuickPick<RecipeQuickPickItem>

const RECIPE_PICK_ACTIONS: RecipeQuickPickItem[] = [
    {
        id: 'root',
        label: "Initial",
        description: "Navigate to the base list of receipes",
        selected: false,
        action: 'root',
        children: undefined,
    },
    {
        id: 'parent',
        label: "Parent",
        description: "Navigate to the parent of this receipe",
        selected: false,
        action: 'parent',
        children: undefined,
    }
]

interface RecipeDescriptor {
    name: string
    displayName: string
    description: string
    tags: string[]
    options: OptionDescriptor[]
    hasSubRecipes: boolean
}

interface OptionDescriptor {
    name: string
    type: string
    displayName: string
    description: string
    example: string
    valid: string[] | undefined
    required: boolean
    value: any
}

interface RecipeSelectionDescriptor {
    selected: boolean
    id: string
    subselection: RecipeSelectionDescriptor[] | undefined
}

interface RecipeQuickPickItem extends coc.QuickPickItem {
    readonly id: string
    selected: boolean
    action?: string | undefined
    children: RecipeQuickPickItem[] | undefined,
    readonly recipeDescriptor?: RecipeDescriptor
}

function getWorkspaceFolderName(file: coc.Uri): string {
    if (file) {
        const wf = coc.workspace.getWorkspaceFolder(file)
        if (wf) {
            return wf.name
        }
    }
    return ''
}

function getRelativePathToWorkspaceFolder(file: coc.Uri): string {
    if (file) {
        const wf = coc.workspace.getWorkspaceFolder(file)
        if (wf) {
            return path.relative(wf.uri, file.fsPath)
        }
    }
    return ''
}

async function getTargetPomXml(): Promise<coc.Uri | undefined> {
    if (coc.window.activeTextEditor) {
        const activeUri = coc.window.activeTextEditor.document.uri
        if ("pom.xml" === path.basename(activeUri).toLowerCase()) {
            return coc.Uri.parse(activeUri)
        }
    }

    const candidates: coc.Uri[] = await coc.workspace.findFiles("**/pom.xml")
    if (candidates.length > 0) {
        if (candidates.length === 1) {
            return candidates[0]
        } else {
            return await coc.window.showQuickPick(
                candidates.map((c: coc.Uri) => ({ value: c, label: getRelativePathToWorkspaceFolder(c), description: getWorkspaceFolderName(c) })),
                { placeholder: "Select the target project." },
            ).then(res => res && res.value)
        }
    }
    return undefined
}

async function showRefactorings(uri: coc.Uri, filter: string) {
    if (!uri) {
        uri = await getTargetPomXml() as coc.Uri
    }
    const choices = await
        showCurrentPathQuickPick(coc.commands.executeCommand<RecipeDescriptor[]>('sts/rewrite/list',
            filter).then((cmds: RecipeDescriptor[]) => cmds.map(d => convertToQuickPickItem(d, false))), [])
    const recipeDescriptors = choices.filter(i => i.selected).map(convertToRecipeSelectionDescriptor)
    if (recipeDescriptors.length) {
        coc.commands.executeCommand('sts/rewrite/execute', uri.toString(true), recipeDescriptors, true)
    } else {
        coc.window.showErrorMessage('No recipes were selected from the list')
    }
}

function convertToRecipeSelectionDescriptor(i: RecipeQuickPickItem): RecipeSelectionDescriptor {
    return {
        id: i.id,
        selected: i.selected,
        subselection: i.children ? i.children.map(convertToRecipeSelectionDescriptor) : undefined
    }
}

function convertToQuickPickItem(i: RecipeDescriptor, selected?: boolean): RecipeQuickPickItem {
    return {
        id: i.name,
        label: i.displayName,
        description: i.description,
        selected: !!selected,
        children: undefined,
        recipeDescriptor: i
    }
}

async function showCurrentPathQuickPick(itemsPromise: Thenable<RecipeQuickPickItem[]>, itemsPath: RecipeQuickPickItem[]): Promise<RecipeQuickPickItem[]> {
    if (!quickPick) {
        quickPick = await coc.window.createQuickPick<RecipeQuickPickItem>()
        const columns = await coc.nvim.eval("&columns") as number
        quickPick.width = Math.ceil(columns * 0.70)
        quickPick.matchOnDescription = true
        quickPick.canSelectMany = true
    }
    quickPick.title = 'Loading Recipes'
    quickPick.value = ""
    quickPick.items = []
    quickPick.loading = true
    quickPick.show()

    return itemsPromise.then(items => {
        return new Promise((resolve, reject) => {
            let currentItems = items
            let parent: RecipeQuickPickItem | undefined
            itemsPath.forEach(p => {
                parent = currentItems.find(i => i === p)
                if (parent?.children) {
                    currentItems = parent?.children
                }
            })

            if (itemsPath.length > 0) {
                currentItems = [...RECIPE_PICK_ACTIONS, ...currentItems]
            } else {
                currentItems = [...currentItems]
            }

            setTimeout(() => {
                quickPick.title = 'Select Recipes'
                quickPick.items = currentItems
                quickPick.loading = false
            }, 175)

            quickPick.onDidChangeSelection(selected => {
                if (selected.filter(i => i.action === "root" || i.action === "parent").length > 0) {
                    return
                }
                currentItems.forEach(i => {
                    const isSelectedItem = selected.includes(i)
                    if (!i.action && i.selected !== isSelectedItem) {
                        selectItemRecursively(i, isSelectedItem)
                    }
                })
                updateParentSelection(itemsPath.slice())
            })

            quickPick.onDidFinish((selectedItems) => {
                const index = quickPick.currIndex
                quickPick = null
                if (selectedItems && selectedItems.length > 0) {
                    resolve(selectedItems)
                    coc.window.showInformationMessage(`Applying ${selectedItems.length} items from the list of recipes `)
                } else {
                    if (index >= 0 && index < currentItems.length) {
                        const item = currentItems[index]
                        if (item.action === "root") {
                            showCurrentPathQuickPick(Promise.resolve(items), []).then(resolve, reject)
                        } else if (item.action === "parent") {
                            itemsPath.pop()
                            showCurrentPathQuickPick(Promise.resolve(items), itemsPath).then(resolve, reject)
                        } else {
                            itemsPath.push(item)
                            const next = navigateToSubRecipes(item, itemsPath).then(() => items)
                            showCurrentPathQuickPick(next, itemsPath).then(resolve, reject)
                        }
                    } else {
                        coc.window.showErrorMessage("Invalid quick list pick index or item from user selection")
                    }
                }
            })
        })
    })
}

async function navigateToSubRecipes(item: RecipeQuickPickItem, itemsPath: RecipeQuickPickItem[]) {
    if (!item.children) {
        const indexPath: any = []
        for (let i = 1; i < itemsPath.length; i++) {
            const parent = itemsPath[i - 1]
            const children = parent?.children
            if (children) {
                indexPath.push(children.indexOf(itemsPath[i]))
            }
        }
        const recipeDescriptors: RecipeDescriptor[] = await coc.commands.executeCommand('sts/rewrite/sublist', itemsPath[0].id, indexPath)
        item.children = recipeDescriptors.map(d => convertToQuickPickItem(d, item.selected))
    }
}

function updateParentSelection(hierarchy: RecipeQuickPickItem[]): void {
    if (hierarchy.length) {
        const parent = hierarchy.pop()
        const isSelected = !!parent?.children?.find(i => i.selected)
        if (parent && parent.selected !== isSelected) {
            parent.selected = isSelected
            updateParentSelection(hierarchy)
        }
    }
}

function selectItemRecursively(i: RecipeQuickPickItem, isSelectedItem: boolean) {
    i.selected = isSelectedItem
    if (i.children) {
        i.children.forEach(c => selectItemRecursively(c, isSelectedItem))
    }
}

export function activate(
    client: coc.LanguageClient,
    options: ActivatorOptions,
    context: coc.ExtensionContext
) {
    context.subscriptions.push(
        coc.commands.registerCommand('springboot.rewrite.list.upgrades', param => {
            if (client.started) {
                return showRefactorings(param, BOOT_UPGRADE)
            } else {
                coc.window.showErrorMessage("No Spring Boot project found. Action is only available for Spring Boot Projects")
            }
        }),
        coc.commands.registerCommand('springboot.rewrite.list.refactors', param => {
            if (client.started) {
                return showRefactorings(param, OTHER_REFACTORINGS)
            } else {
                coc.window.showErrorMessage("No Spring Boot project found. Action is only available for Spring Boot Projects")
            }
        }),
        coc.commands.registerCommand('springboot.rewrite.reload', () => {
            if (client.started) {
                return coc.commands.executeCommand('sts/rewrite/reload')
            } else {
                coc.window.showErrorMessage("No Spring Boot project found. Action is only available for Spring Boot Projects")
            }
        })
    )
}
