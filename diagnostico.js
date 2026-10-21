import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import dotenv from "dotenv";
dotenv.config();

const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@_davideast/stitch-mcp", "proxy"],
    env: { ...process.env }
});
const c = new Client({ name: "diag", version: "1.0" }, { capabilities: {} });
await c.connect(transport);
const r = await c.callTool({ name: "list_projects", arguments: {} });
const { projects = [] } = JSON.parse(r.content[0].text);
for (const p of projects) {
    const id = p.name.split("/")[1];
    let screens = [];
    try {
        const s = await c.callTool({ name: "list_screens", arguments: { projectId: id } });
        screens = JSON.parse(s.content[0].text).screens || [];
    } catch (e) { screens = [{ title: "ERR " + e.message }]; }
    console.log(`\n${p.title} | id=${id} | creado=${p.createTime} | actualizado=${p.updateTime} | pantallas=${screens.length}`);
    for (const sc of screens) console.log("   -", sc.title || sc.name);
}
await c.close();
