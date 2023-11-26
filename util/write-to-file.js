import { promises as fs } from "fs";
async function writeToFile(component, content) {
  const file = `${process.cwd()}/tests/${component}.spec.js`;
  if (!content) {
    return;
  }
  try {
    await fs.writeFile(file, content, "utf8");
    console.log(`Successfully wrote to file ${file}`);
  } catch (err) {
    console.error(`Error writing to file ${file}: `, err);
  }
}

export default writeToFile;
