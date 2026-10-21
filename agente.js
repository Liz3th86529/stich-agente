import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

async function iniciarAgente() {
    console.log("\n Iniciando conexión con Stitch MCP...");

    // 1. Levantar el servidor local de Stitch
    const transport = new StdioClientTransport({
        command: "npx",
        args: ["-y", "@_davideast/stitch-mcp", "proxy"],
        env: { ...process.env } // incluye STITCH_API_KEY del .env
    });

    if (!process.env.STITCH_API_KEY && !process.env.STITCH_ACCESS_TOKEN) {
        console.error("\n Falta STITCH_API_KEY en el archivo .env");
        process.exit(1);
    }

    const mcpClient = new Client(
        { name: "agente-stitch", version: "1.0" },
        { capabilities: {} }
    );

    await mcpClient.connect(transport);

    // 2. Leer y traducir las herramientas de MCP para OpenRouter
    const mcpTools = await mcpClient.listTools();
    const openRouterTools = mcpTools.tools.map(tool => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }
    }));

    console.log(`\n Conexión exitosa. ${openRouterTools.length} herramientas disponibles.`);

    // Cliente de OpenRouter (compatible con la API de OpenAI)
    const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY
    });

    // Tarea a realizar: se puede pasar por línea de comandos -> node agente.js "mi tarea"
    const systemPromt = `Eres un Ingeniero Frontend y Experto en UX/UI.
Tu objetivo es traducir los requerimientos del usuario en interfaces funcionales usando las herramientas de Stitch.
Reglas:
1. Para generar una pantalla nueva, si no te han dado un projectId, PRIMERO crea un proyecto con 'create_project' (con un título descriptivo).
2. Luego usa 'generate_screen_from_text' pasando el 'projectId' recién creado y el 'prompt' detallado con los requerimientos visuales.
   IMPORTANTE: 'create_project' devuelve un nombre como "projects/123456"; el 'projectId' es SOLO el número ("123456"), sin el prefijo "projects/". Nunca inventes IDs ni reutilices IDs de otros proyectos.
   Genera UNA pantalla por llamada y espera su resultado antes de la siguiente.
3. Si una herramienta falla, lee el error, ajusta los parámetros y vuelve a intentarlo.
4. Al terminar, informa al usuario el ID del proyecto y la URL o pantallas generadas.`;

    const userPromt =
        process.argv.slice(2).join(" ") || "Crea un proyecto nuevo y genera 4 pantallas para una aplicación web de un restaurante. La primera pantalla debe ser de inicio de sesión con campos para usuario y contraseña, un botón azul oscuro para iniciar sesión, una opción para recordar sesión, un enlace para registrarse y otro para recuperar la contraseña. La segunda pantalla debe ser de registro de usuario con los campos necesarios para crear una cuenta y un botón para registrarse. La tercera pantalla debe ser el menú principal del restaurante, mostrando los platillos con su imagen, nombre, descripción, precio y categorías, además de un botón para acceder al perfil del usuario. La cuarta pantalla debe ser el perfil del usuario, donde pueda visualizar y editar su información personal, como nombre, correo electrónico, contraseña y foto de perfil, incluyendo un botón para guardar los cambios. Todas las pantallas deben tener un diseño moderno, responsive y una navegación intuitiva entre ellas.";

    const mensajes = [
        { role: "system", content: systemPromt },
        { role: "user", content: userPromt }
    ];

    let tareaCompletada = false;

    // 3. El Bucle del Agente (Agentic Loop) 
    while (!tareaCompletada) {
        const respuesta = await openai.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct", // Se usa Claude a través de OpenRouter 
            messages: mensajes,
            tools: openRouterTools,
        });
        const mensajeModelo = respuesta.choices[0].message;
        mensajes.push(mensajeModelo);
        // Si el modelo decide usar una herramienta de Stitch 
        if (mensajeModelo.tool_calls && mensajeModelo.tool_calls.length > 0) {
            for (const toolCall of mensajeModelo.tool_calls) {
                console.log(`
🛠
 Acción del Agente -> Ejecutando: 
${toolCall.function.name}`);
                try {
                    const argumentos = JSON.parse(toolCall.function.arguments);
                    // Ejecutar la acción en la máquina local 
                    console.log("   Argumentos:", JSON.stringify(argumentos));
                    // Stitch puede tardar varios minutos en generar una pantalla;
                    // el timeout por defecto del SDK (60s) es demasiado corto.
                    const resultado = await mcpClient.callTool(
                        { name: toolCall.function.name, arguments: argumentos },
                        undefined,
                        { timeout: 10 * 60 * 1000, resetTimeoutOnProgress: true }
                    );
                    // Las herramientas MCP no lanzan excepción al fallar: devuelven isError
                    if (resultado.isError) {
                        throw new Error(JSON.stringify(resultado.content));
                    }
                    // Devolver el resultado de la herramienta a la memoria del LLM 
                    mensajes.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: JSON.stringify(resultado)
                    });
                    console.log(`\n✅ Acción completada. Respuesta:`, JSON.stringify(resultado, null, 2));
                } catch (error) {
                    console.log(`
⚠
 Error en la herramienta: ${error.message}. Informando 
al agente para que corrija...`);
                    mensajes.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: `Error: ${error.message}`
                    });
                }
            }
        } else {
            // Si ya no usa herramientas, significa que terminó el trabajo y nos responde con texto 
            console.log(`\n Agente: ${mensajeModelo.content}`); tareaCompletada = true;
        }
    }

    await mcpClient.close();
}
iniciarAgente().catch(console.error);