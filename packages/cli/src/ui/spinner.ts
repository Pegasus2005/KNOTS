import ora, { type Ora } from 'ora';
import chalk from 'chalk';

export interface SpinnerInstance {
  start(text?: string): SpinnerInstance;
  text(text: string): SpinnerInstance;
  succeed(text?: string): SpinnerInstance;
  fail(text?: string): SpinnerInstance;
  warn(text?: string): SpinnerInstance;
  info(text?: string): SpinnerInstance;
  stop(): SpinnerInstance;
}

/**
 * Create a new ora spinner wrapper with standard knots styling.
 */
export function createSpinner(initialText?: string): SpinnerInstance {
  const spinner: Ora = ora({
    text: initialText ? chalk.cyan(initialText) : '',
    color: 'cyan',
    discardStdin: false,
  });

  const wrapper: SpinnerInstance = {
    start(text?: string) {
      if (text) spinner.text = chalk.cyan(text);
      spinner.start();
      return wrapper;
    },
    text(text: string) {
      spinner.text = chalk.cyan(text);
      return wrapper;
    },
    succeed(text?: string) {
      if (text) {
        spinner.succeed(chalk.green(text));
      } else {
        spinner.succeed();
      }
      return wrapper;
    },
    fail(text?: string) {
      if (text) {
        spinner.fail(chalk.red(text));
      } else {
        spinner.fail();
      }
      return wrapper;
    },
    warn(text?: string) {
      if (text) {
        spinner.warn(chalk.yellow(text));
      } else {
        spinner.warn();
      }
      return wrapper;
    },
    info(text?: string) {
      if (text) {
        spinner.info(chalk.blue(text));
      } else {
        spinner.info();
      }
      return wrapper;
    },
    stop() {
      spinner.stop();
      return wrapper;
    },
  };

  return wrapper;
}
