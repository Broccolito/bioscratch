// esbuild inlines `.yaml` files as strings via the `text` loader.
declare module "*.yaml" {
  const content: string;
  export default content;
}

// Side-effect CSS imports are handled by esbuild's `css` loader; declare them
// so TypeScript accepts `import "./foo.css"`.
declare module "*.css";
