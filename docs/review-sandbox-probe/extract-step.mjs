const argv = process.argv.slice(2);
const fieldAt = argv.indexOf("--field");
let field;
if (fieldAt >= 0) {
  field = argv[fieldAt + 1];
  argv.splice(fieldAt, 2);
  if (!field) {
    console.error("usage: bun extract-step.mjs <workflow> <step name> --field <dotted key>");
    process.exit(2);
  }
}
const [workflowPath, stepName, fromLine, toLine] = argv;

if (!workflowPath || !stepName) {
  console.error("usage: bun extract-step.mjs <workflow> <step name> [first line] [last line] | --field <dotted key>");
  process.exit(2);
}

const workflow = Bun.YAML.parse(await Bun.file(workflowPath).text());
const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
const matches = steps.filter((step) => step.name === stepName);

if (field !== undefined) {
  if (matches.length !== 1) {
    console.error(`expected one step named "${stepName}", found ${matches.length}`);
    process.exit(2);
  }
  let value = matches[0];
  for (const key of field.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
      console.error(`field not found in "${stepName}": ${field}`);
      process.exit(2);
    }
    value = value[key];
  }
  if (value !== null && typeof value === "object") {
    console.error(`field "${field}" in "${stepName}" is not a scalar`);
    process.exit(2);
  }
  process.stdout.write(String(value) + "\n");
  process.exit(0);
}

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
