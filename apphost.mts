import { createBuilder } from './.aspire/modules/aspire.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const builder = await createBuilder();
const npmrcPath = fileURLToPath(new URL('./.npmrc', import.meta.url));
const uvConfigPath = fileURLToPath(new URL('./uv.toml', import.meta.url));
const uvCachePath = fileURLToPath(new URL('./.cache/uv', import.meta.url));
const uvArgs = ["sync", "--cache-dir", uvCachePath];

if (existsSync(uvConfigPath)) {
    uvArgs.push("--config-file", uvConfigPath);
}

// Add the following line to configure the Docker Compose environment
await builder.addDockerComposeEnvironment("env");

// Add a Redis cache for the app to use.
const cache = await builder
    .addRedis("cache");

// Run the Python FastAPI app and expose its HTTP endpoint externally.
const app = await builder
    .addUvicornApp("app", "./app", "main:app")
    .withUv({ args: uvArgs })
    .withExternalHttpEndpoints()
    .withReference(cache)
    .waitFor(cache)
    .withHttpHealthCheck({ path: "/health" });

const uvConfig = existsSync(uvConfigPath)
    ? await builder.addParameter("uv-config", {
        value: readFileSync(uvConfigPath, "utf8"),
        secret: true,
    })
    : undefined;

await app.publishAsDockerFile(async container => {
    await container.withArgs(["main:app", "--host", "0.0.0.0", "--port", "8000"]);

    await container.withDockerfileBuilder("./app", async context => {
        const dockerfile = context.builder();
        const resource = context.resource();
        const uvMounts = [
            "type=cache,target=/tmp/uv-cache",
            "type=secret,id=uv-config,target=/run/secrets/uv-config,required=false",
        ];
        const configureUv = "if [ -f /run/secrets/uv-config ]; then export UV_CONFIG_FILE=/run/secrets/uv-config; fi;";

        const buildStage = dockerfile
            .from("ghcr.io/astral-sh/uv:python3.13-bookworm-slim", { stageName: "builder" })
            .env("UV_COMPILE_BYTECODE", "1")
            .env("UV_LINK_MODE", "copy")
            .env("UV_CACHE_DIR", "/tmp/uv-cache")
            .workDir("/app")
            .copy("pyproject.toml", "/app/")
            .runWithMounts(`${configureUv} uv sync --no-install-project --no-dev`, uvMounts)
            .copy(".", "/app")
            .runWithMounts(`${configureUv} uv sync --no-dev`, uvMounts);

        await buildStage;
        await dockerfile.addContainerFilesStages(resource);

        await dockerfile
            .from("python:3.13-slim-bookworm", { stageName: "app" })
            .addContainerFiles(resource, "/app")
            .run("groupadd --system --gid 999 appuser && useradd --system --gid 999 --uid 999 --create-home appuser")
            .copyFrom("builder", "/app", "/app", { chown: "appuser:appuser" })
            .env("PATH", "/app/.venv/bin:${PATH}")
            .env("VIRTUAL_ENV", "/app/.venv")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("PYTHONUNBUFFERED", "1")
            .user("appuser")
            .workDir("/app")
            .entrypoint(["uvicorn"]);
    }, { stage: "app" });

    if (uvConfig) {
        await container.withBuildSecret("uv-config", uvConfig);
    }
});

// Run the Vite frontend after the API and inject the API URL for local proxying.
const frontend = await builder
    .addViteApp("frontend", "./frontend")
    .withReference(app)
    .waitFor(app);

if (existsSync(npmrcPath)) {
    const npmrc = await builder.addParameter("npmrc", {
        value: readFileSync(npmrcPath, "utf8"),
        secret: true,
    });

    await frontend.publishAsDockerFile(async container => {
        await container.withBuildSecret("npmrc", npmrc);
    });
}

// Bundle the frontend build output into the API container for publish/deploy.
await app.publishWithContainerFiles(frontend, "./static");

await builder.build().run();
