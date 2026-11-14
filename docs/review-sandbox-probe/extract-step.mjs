const [workflowPath, stepName, fromLine, toLine] = process.argv.slice(2);

if (!workflowPath || !stepName) {
  console.error("usage: bun extract-step.mjs <workflow> <step name> [first line] [last line]");
  process.exit(2);
}

const workflow = Bun.YAML.parse(await Bun.file(workflowPath).text());
const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
const matches = steps.filter((step) => step.name === stepName);
if (matches.length !== 1 || typeof matches[0].run !== "string") {
  console.error(`expected one run step named "${stepName}", found ${matches.length}`);
  process.exit(2);
}

let lines = matches[0].run.split("\n");
if (fromLine !== undefined) {
  const start = lines.indexOf(fromLine);
  if (start < 0) {
    console.error(`line not found in "${stepName}": ${fromLine}`);
    process.exit(2);
  }
  lines = lines.slice(start);
}
if (toLine !== undefined) {
  const end = lines.indexOf(toLine);
  if (end < 0) {
    console.error(`line not found in "${stepName}": ${toLine}`);
    process.exit(2);
  }
  lines = lines.slice(0, end + 1);
}

process.stdout.write(lines.join("\n") + "\n");
