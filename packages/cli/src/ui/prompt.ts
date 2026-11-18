import inquirer from 'inquirer';

export async function promptInput(
  message: string,
  defaultValue?: string,
  validate?: (input: string) => boolean | string | Promise<boolean | string>,
): Promise<string> {
  const result = await inquirer.prompt<{ value: string }>([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
      validate,
    },
  ]);
  return result.value.trim();
}

export async function promptPassword(
  message: string,
  validate?: (input: string) => boolean | string | Promise<boolean | string>,
): Promise<string> {
  const result = await inquirer.prompt<{ value: string }>([
    {
      type: 'password',
      name: 'value',
      message,
      mask: '*',
      validate,
    },
  ]);
  return result.value.trim();
}

export async function promptSelect<T extends string = string>(
  message: string,
  choices: Array<{ name: string; value: T } | string>,
  defaultValue?: T,
): Promise<T> {
  const result = await inquirer.prompt<{ value: T }>([
    {
      type: 'list',
      name: 'value',
      message,
      choices,
      default: defaultValue,
    },
  ]);
  return result.value;
}

export async function promptCheckbox<T extends string = string>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean } | string>,
): Promise<T[]> {
  const result = await inquirer.prompt<{ value: T[] }>([
    {
      type: 'checkbox',
      name: 'value',
      message,
      choices,
    },
  ]);
  return result.value;
}

export async function promptConfirm(message: string, defaultValue = true): Promise<boolean> {
  const result = await inquirer.prompt<{ value: boolean }>([
    {
      type: 'confirm',
      name: 'value',
      message,
      default: defaultValue,
    },
  ]);
  return result.value;
}
