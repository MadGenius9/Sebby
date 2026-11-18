import type { ProjectDocument } from "./schema.js";
export function starter(
  name: string,
  template: "blank" | "web" = "blank",
): ProjectDocument {
  const files: ProjectDocument["files"] = [
    {
      path: "README.md",
      content: `# ${name}\n\nDescribe what you want to build here.\n`,
    },
  ];
  if (template === "web")
    files.push(
      {
        path: "index.html",
        content:
          '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Sebby app</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Made with Sebby</h1><p>Your first project is ready to shape.</p><button id="counter">Clicked 0 times</button></main><script src="app.js"></script></body></html>\n',
      },
      {
        path: "style.css",
        content:
          "body { margin:0; min-height:100vh; display:grid; place-items:center; background:#121820; color:#e8f3ff; font:16px system-ui; } main { padding:32px; text-align:center; } h1 { font-size:clamp(28px,6vw,48px); } button { background:#83ceff; color:#10202d; padding:12px 20px; border:0; border-radius:8px; cursor:pointer; font:inherit; }\n",
      },
      {
        path: "app.js",
        content:
          "let clicks = 0;\nconst button = document.querySelector('#counter');\nbutton.addEventListener('click', () => {\n  clicks += 1;\n  button.textContent = `Clicked ${clicks} times`;\n});\n",
      },
      {
        path: "package.json",
        content:
          JSON.stringify(
            {
              name: "sebby-web-project",
              private: true,
              type: "module",
              scripts: { test: "node --check app.js", build: "node build.mjs" },
            },
            null,
            2,
          ) + "\n",
      },
      {
        path: "build.mjs",
        content:
          "import {mkdir,copyFile} from 'node:fs/promises';\nawait mkdir('dist',{recursive:true});\nfor(const file of ['index.html','style.css','app.js']) await copyFile(file,`dist/${file}`);\nconsole.log('Built index.html, style.css and app.js into dist/');\n",
      },
    );
  return { name, files, scene: { objects: [] } };
}
