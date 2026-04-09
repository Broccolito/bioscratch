# Image Rendering Test

This fixture tests automatic image rendering from `![alt](url)` markdown syntax.

## Remote Image (landscape)

The image below is loaded from a remote URL. It should render full-width and centered by default.

![Landscape](https://picsum.photos/seed/landscape/800/400)

After the image, text continues normally.

## Remote Image (ocean)

![City](https://picsum.photos/seed/city/800/400)

## Local Image (from the fixtures/img folder)

The image below is loaded from a local path relative to the document. Open this file from inside the `tests/fixtures/` directory for the relative path to resolve correctly.

![shiba](img/shiba.jpg)

Isn't that a good dog?

## Multiple Images in Sequence

![Forest](https://picsum.photos/seed/forest/800/400)

![Shiba Inu](img/shiba.jpg)

## Image with Alt Text and Title

![A scenic mountain landscape](https://picsum.photos/seed/mountain/800/400 "Mountain scenery")

## Broken Image (should show placeholder)

![This image does not exist](https://example.invalid/nonexistent-image.png)

## Inline Image Inside a Paragraph

This paragraph contains an inline image ![Shiba Inu](img/shiba.jpg) embedded in the middle of the text. The image renders inline but takes on block-like styling due to the NodeView.
