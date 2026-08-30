# 🤖 Zoi CLI

**Zoi CLI** es un asistente de línea de comandos inteligente y modular impulsado por modelos de inteligencia artificial locales (a través de `llama.cpp` / `llama-server`) y búsqueda web privada.

---

## 📋 Requisitos Previos

Antes de ejecutar **Zoi CLI**, asegúrate de contar con los siguientes componentes en tu sistema:

1. **[Deno](https://deno.land/)** (versión 2.0 o superior).
2. **[llama.cpp](https://github.com/ggerganov/llama.cpp)**:
   - Debe estar disponible el binario `llama-server` (o configurar su ruta en `config.json`).
   - Modelos en formato GGUF descargados localmente según se especifiquen en `config.json`.
3. **[SearXNG](https://github.com/searxng/searxng)** ⚠️ **(Obligatorio)**:
   - **Es necesario tener corriendo una instancia local del metabuscador [SearXNG](https://github.com/searxng/searxng)** para permitir la búsqueda de documentación web y contexto de comandos/aplicaciones.
   - Por defecto, Zoi busca SearXNG en `http://localhost:17380` (puedes personalizarlo con la variable de entorno `SEARXNG_URL`).
4. **Navegador para extracción SPA (Puppeteer):**
   - Para extraer contenido renderizado dinámicamente de páginas SPA:
     ```bash
     npx puppeteer browsers install firefox
     ```

---

## 🚀 Despliegue Rápido de SearXNG

Puedes iniciar una instancia de [SearXNG](https://github.com/searxng/searxng) rápidamente usando Docker:

```bash
docker run -d \
  --name searxng \
  -p 17380:8080 \
  -e "SEARXNG_BASE_URL=http://localhost:17380/" \
  -e "SEARXNG_SECRET=zoi_secret_key" \
  searxng/searxng:latest
```

O si prefieres `docker-compose`:

```yaml
version: "3.7"
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    ports:
      - "17380:8080"
    environment:
      - SEARXNG_BASE_URL=http://localhost:17380/
      - SEARXNG_SECRET=zoi_secret_key
    restart: unless-stopped
```

> [!IMPORTANT]
> Asegúrate de que el formato de salida JSON esté habilitado en la configuración de SearXNG si usas una configuración personalizada (`settings.yml` -> `search.formats: [html, json]`).

---

## ⚙️ Configuración

El archivo [`config.json`](./config.json) define los parámetros de los modelos de IA y el puerto del servidor:

```json
{
  "ai": {
    "port": "18080",
    "server-path": "llama-server",
    "model": {
      "granite-4.0-h-350m:BF16": {
        "main": "/ruta/a/tu/modelo/granite-4.0-h-350m-bf16.gguf"
      },
      "granite-4.0-h-1b:BF16": {
        "main": "/ruta/a/tu/modelo/granite-4.0-h-1b-bf16.gguf"
      }
    }
  }
}
```

---

## 🛠️ Instalación y Uso

1. **Clonar el repositorio:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd zoi-cli
   ```

2. **Instalar el navegador para Puppeteer:**
   ```bash
   npx puppeteer browsers install firefox
   ```

3. **Ejecutar en modo desarrollo:**
   ```bash
   deno task dev
   ```

4. **Ejecutar pruebas unitarias:**
   ```bash
   deno task test
   ```

---

## ✨ Características Principales

- **Gestión inteligente de modelos locales (`llama-server`):**
  - Carga bajo demanda y auto-detención de modelos al finalizar las peticiones para liberar memoria RAM/VRAM.
  - Limpieza y liberación automática de puertos (`killPortProcess`) ante colisiones o procesos residuales.
- **Búsqueda web privada integrada:** Conexión con [SearXNG](https://github.com/searxng/searxng) para consultar documentación y contexto en tiempo real.
- **Detección y análisis de comandos locales:** Indexación con Deno KV y extracción de documentación y uso de comandos (`--help`, web, IA).
- **Procesamiento de lenguaje e intención:** Traducción contextual y refinamiento de prompts para interactuar con la terminal de forma natural.
