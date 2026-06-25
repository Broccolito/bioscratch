import { Plugin } from "prosemirror-state";
import { schema } from "../schema";

export function buildDropImagePlugin(): Plugin {
  return new Plugin({
    props: {
      handleDrop(view, event) {
        const evt = event as DragEvent;
        if (!evt.dataTransfer) return false;

        const files = Array.from(evt.dataTransfer.files).filter((f) =>
          f.type.startsWith("image/")
        );

        if (files.length === 0) return false;

        evt.preventDefault();

        const coordinates = view.posAtCoords({
          left: evt.clientX,
          top: evt.clientY,
        });

        if (!coordinates) return false;

        for (const file of files) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (!dataUrl) return;

            const node = schema.nodes.image.create({
              src: dataUrl,
              alt: file.name,
            });

            const tr = view.state.tr.insert(coordinates.pos, node);
            view.dispatch(tr);
          };
          reader.readAsDataURL(file);
        }

        return true;
      },

      handlePaste(view, event) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const items = Array.from(clipboardData.items);
        const imageItems = items.filter((item) => item.type.startsWith("image/"));

        if (imageItems.length === 0) return false;

        event.preventDefault();

        for (const item of imageItems) {
          const file = item.getAsFile();
          if (!file) continue;

          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (!dataUrl) return;

            const node = schema.nodes.image.create({
              src: dataUrl,
              alt: "pasted image",
            });

            const tr = view.state.tr.replaceSelectionWith(node);
            view.dispatch(tr);
          };
          reader.readAsDataURL(file);
        }

        return true;
      },
    },
  });
}
