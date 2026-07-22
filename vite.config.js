import { defineConfig } from "vite";

const githubRepository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = process.env.VITE_BASE_PATH
  ?? (process.env.GITHUB_ACTIONS === "true" && githubRepository ? `/${githubRepository}/` : "/");

export default defineConfig({ base });
