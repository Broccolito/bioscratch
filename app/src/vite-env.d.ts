/// <reference types="vite/client" />

// Stylesheets with embedded font data for standalone HTML/PDF exports.
declare module "*.css?embedded" {
  const content: string;
  export default content;
}
