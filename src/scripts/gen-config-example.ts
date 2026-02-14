import * as fs from 'fs';
import yaml from 'yaml';
import { defaultConfig } from '../config';

function toCamelCaseKey(key: string): string {
  const lower = key.toLowerCase();
  return lower.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

function toTypedValue(value: string): string | number {
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return value;
}

async function main(): Promise<void> {
  const exampleConfig = Object.fromEntries(
    Object.entries(defaultConfig).map(([key, value]) => {
      if (value.includes(',')) {
        const items = value.split(',').map((item) => toTypedValue(item));
        return [toCamelCaseKey(key), items];
      }
      return [toCamelCaseKey(key), toTypedValue(value)];
    }),
  );
  const output = yaml.stringify(exampleConfig);
  await fs.promises.writeFile('./config.example.yaml', output, 'utf-8');
  console.log('Generated config.example.yaml');
}

main().catch((error) => {
  console.error(`Failed to generate config.example.yaml: ${error}`);
  process.exitCode = 1;
});
