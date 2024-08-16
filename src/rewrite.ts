import {ActivatorOptions} from "./utils";
import {Uri, LanguageClient} from "coc.nvim";
import * as coc from 'coc.nvim';
import * as path from "path";

const BOOT_UPGRADE = 'BOOT_UPGRADE';
const OTHER_REFACTORINGS = 'NON_BOOT_UPGRADE';

interface RecipeDescriptor {
    name: string;
    displayName: string;
    description: string;
    tags: string[];
    options: OptionDescriptor[];
    hasSubRecipes: boolean;
}

interface OptionDescriptor {
    name: string;
    type: string;
    displayName: string;
    description: string;
    example: string;
    valid: string[] | undefined;
    required: boolean;
    value: any;
}

interface RecipeSelectionDescriptor {
    selected: boolean;
    id: string;
    subselection: RecipeSelectionDescriptor[];
}

interface RecipeQuickPickItem extends coc.QuickPickItem {
    readonly id: string;
    selected: boolean;
    children: RecipeQuickPickItem[] | undefined,
    readonly recipeDescriptor: RecipeDescriptor;
}

function getWorkspaceFolderName(file: coc.Uri): string {
    if (file) {
        const wf = coc.workspace.getWorkspaceFolder(file);
        if (wf) {
            return wf.name;
        }
    }
    return '';
}

function getRelativePathToWorkspaceFolder(file: coc.Uri): string {
    if (file) {
        const wf = coc.workspace.getWorkspaceFolder(file);
        if (wf) {
            return path.relative(Uri.parse(wf.uri).fsPath, file.fsPath);
        }
    }
    return '';
}

async function getTargetPomXml(): Promise<coc.Uri | undefined> {
    if (coc.window.activeTextEditor) {
        const activeUri = coc.window.activeTextEditor.document.uri;
        if ("pom.xml" === path.basename(activeUri).toLowerCase()) {
            return Uri.parse(activeUri);
        }
    }

    const candidates: coc.Uri[] = await coc.workspace.findFiles("**/pom.xml");
    if (candidates.length > 0) {
        if (candidates.length === 1) {
            return candidates[0];
        } else {
            return await coc.window.showQuickPick(
                candidates.map((c: coc.Uri) => ({value: c, label: getRelativePathToWorkspaceFolder(c), description: getWorkspaceFolderName(c)})),
                {placeholder: "Select the target project."},
            ).then(res => res?.value);
        }
    }
    return undefined;
}

async function showRefactorings(uri: coc.Uri, filter: string) {
    if (!uri) {
        uri = await getTargetPomXml();
    }
    const choices = await showCurrentPathQuickPick(coc.commands.executeCommand('sts/rewrite/list', filter).then((cmds: RecipeDescriptor[]) => cmds.map(d => convertToQuickPickItem(d, false))), []);
    const recipeDescriptors = choices.filter(i => i.selected).map(convertToRecipeSelectionDescriptor);
    if (recipeDescriptors.length) {
        coc.commands.executeCommand('sts/rewrite/execute', uri.toString(true), recipeDescriptors, true);
    } else {
        coc.window.showErrorMessage('No Recipes were selected!');
    }
}

function convertToRecipeSelectionDescriptor(i: RecipeQuickPickItem): RecipeSelectionDescriptor {
    return {
        id: i.id,
        selected: i.selected,
        subselection: i.children ? i.children.map(convertToRecipeSelectionDescriptor) : undefined
    };
}

function convertToQuickPickItem(i: RecipeDescriptor, selected?: boolean): RecipeQuickPickItem {
    return {
        id: i.name,
        label: i.displayName,
        detail: i.options.filter(o => !!o.value).map(o => `${o.name}: ${JSON.stringify(o.value)}`).join('\n\n'),
        description: i.description,
        selected: !!selected,
        children: undefined,
        buttons: i.hasSubRecipes ? [SUB_RECIPES_BUTTON] : undefined,
        recipeDescriptor: i
    };
}

function showCurrentPathQuickPick(itemsPromise: Thenable<RecipeQuickPickItem[]>, itemsPath: RecipeQuickPickItem[]): Thenable<RecipeQuickPickItem[]> {
    const quickPick = coc.window.createQuickPick<RecipeQuickPickItem>();
    quickPick.title = 'Loading Recipes...';
    quickPick.canSelectMany = true;
    quickPick.busy = true;
    quickPick.show();
    return itemsPromise.then(items => {
        return new Promise((resolve, reject) => {
            let currentItems = items;
            let parent: RecipeQuickPickItem | undefined;
            itemsPath.forEach(p => {
                parent = currentItems.find(i => i === p);
                currentItems = parent.children;
            });
            quickPick.items = currentItems;
            if (itemsPath.length) {
                quickPick.buttons = [PARENT_RECIPE_BUTTON, ROOT_RECIPES_BUTTON];
            }
            quickPick.selectedItems = currentItems.filter(i => i.selected);
            quickPick.onDidTriggerItemButton(e => {
                if (e.button === SUB_RECIPES_BUTTON) {
                    currentItems.forEach(i => i.selected = quickPick.selectedItems.includes(i));
                    itemsPath.push(e.item);
                    showCurrentPathQuickPick(navigateToSubRecipes(e.item, itemsPath).then(() => items), itemsPath).then(resolve, reject);
                }
            });
            quickPick.onDidTriggerButton(b => {
                if (b === ROOT_RECIPES_BUTTON) {
                    currentItems.forEach(i => i.selected = quickPick.selectedItems.includes(i));
                    itemsPath.splice(0, itemsPath.length);
                    showCurrentPathQuickPick(Promise.resolve(items), itemsPath).then(resolve, reject);
                } else if (b === PARENT_RECIPE_BUTTON) {
                    currentItems.forEach(i => i.selected = quickPick.selectedItems.includes(i));
                    itemsPath.pop();
                    showCurrentPathQuickPick(Promise.resolve(items), itemsPath).then(resolve, reject);
                }
            });
            quickPick.onDidAccept(() => {
                currentItems.forEach(i => i.selected = quickPick.selectedItems.includes(i));
                quickPick.hide();
                resolve(items);
            });
            quickPick.onDidChangeSelection(selected => {
                currentItems.forEach(i => {
                    const isSelectedItem = selected.includes(i);
                    if (i.selected !== isSelectedItem) {
                        selectItemRecursively(i, isSelectedItem);
                    }
                });
                updateParentSelection(itemsPath.slice());
            });
            quickPick.title = 'Select Recipes';
            quickPick.busy = false;
        });
    });
}

async function navigateToSubRecipes(item: RecipeQuickPickItem, itemsPath: RecipeQuickPickItem[]) {
    if (!item.children) {
        const indexPath = [];
        for (let i = 1; i < itemsPath.length; i++) {
            indexPath.push(itemsPath[i - 1].children.indexOf(itemsPath[i]));
        }
        const recipeDescriptors: RecipeDescriptor[] = await coc.commands.executeCommand('sts/rewrite/sublist', itemsPath[0].id, indexPath);
        item.children = recipeDescriptors.map(d => convertToQuickPickItem(d, item.selected));
    }
}

function updateParentSelection(hierarchy: RecipeQuickPickItem[]): void {
    if (hierarchy.length) {
        const parent = hierarchy.pop();
        if (parent) {
            const isSelected = !!parent.children?.find(i => i.selected);
            if (parent.selected !== isSelected) {
                parent.selected = isSelected;
                updateParentSelection(hierarchy)
            }
        }
    }
}

function selectItemRecursively(i: RecipeQuickPickItem, isSelectedItem: boolean) {
    i.selected = isSelectedItem;
    if (i.children) {
        i.children.forEach(c => selectItemRecursively(c, isSelectedItem));
    }
}

export function activate(
    client: LanguageClient,
    options: ActivatorOptions,
    context: coc.ExtensionContext
) {
    context.subscriptions.push(
        coc.commands.registerCommand('springboot.rewrite.list.boot-upgrades', param => {
            if (client.started) {
                return showRefactorings(param, BOOT_UPGRADE);
            } else {
                coc.window.showErrorMessage("No Spring Boot project found. Action is only available for Spring Boot Projects");
            }
        }),
        coc.commands.registerCommand('springboot.rewrite.list.refactorings', param => {
            if (client.started) {
                return showRefactorings(param, OTHER_REFACTORINGS);
            } else {
                coc.window.showErrorMessage("No Spring Boot project found. Action is only available for Spring Boot Projects");
            }
        }),
        coc.commands.registerCommand('springboot.rewrite.reload', () => {
            if (client.started) {
                return coc.commands.executeCommand('sts/rewrite/reload');
            } else {
                coc.window.showErrorMessage("No Spring Boot project found. Action is only available for Spring Boot Projects");
            }
        })
    );
}
