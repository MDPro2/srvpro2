import * as fs from 'fs';
import yaml from 'yaml';
import { defaultConfig } from '../config';

async function main(): Promise<void> {
  const output = yaml.stringify(defaultConfig);
  await fs.promises.writeFile('./config.example.yaml', output, 'utf-8');
  console.log('Generated config.example.yaml');
}

main().catch((error) => {
  console.error(`Failed to generate config.example.yaml: ${error}`);
  process.exitCode = 1;
});
