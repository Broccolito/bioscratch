# Bioscratch R fixture — tests R syntax highlighting.

library(ggplot2)
library(dplyr)

# ── Constants ─────────────────────────────────────────────────────────────────
LARGE_FILE_THRESHOLD <- 1e6  # bytes

# ── Data structures ───────────────────────────────────────────────────────────

#' Create a simple document object
#'
#' @param path  Optional file path
#' @param content  Text content of the document
#' @return A list representing the document
new_document <- function(path = NULL, content = "", dirty = FALSE) {
  structure(
    list(path = path, content = content, dirty = dirty),
    class = "Document"
  )
}

word_count <- function(doc) {
  length(unlist(strsplit(trimws(doc$content), "\\s+")))
}

print.Document <- function(doc, ...) {
  fname <- if (is.null(doc$path)) "Untitled" else basename(doc$path)
  cat(sprintf("<Document '%s' — %d words>\n", fname, word_count(doc)))
}

# ── I/O helpers ───────────────────────────────────────────────────────────────

load_document <- function(path) {
  size <- file.info(path)$size
  if (!is.na(size) && size > LARGE_FILE_THRESHOLD) {
    ans <- readline(sprintf("'%s' is %.1f MB. Open anyway? [y/N] ", path, size / 1e6))
    if (tolower(trimws(ans)) != "y") stop("Aborted.")
  }
  content <- paste(readLines(path, warn = FALSE), collapse = "\n")
  new_document(path = path, content = content)
}

# ── Example analysis ─────────────────────────────────────────────────────────

set.seed(42)
df <- tibble(
  x = rnorm(200),
  y = 2 * x + rnorm(200, sd = 0.5),
  group = sample(c("A", "B", "C"), 200, replace = TRUE)
)

summary_stats <- df %>%
  group_by(group) %>%
  summarise(
    n       = n(),
    mean_x  = mean(x),
    mean_y  = mean(y),
    cor_xy  = cor(x, y)
  )

print(summary_stats)

p <- ggplot(df, aes(x = x, y = y, colour = group)) +
  geom_point(alpha = 0.6) +
  geom_smooth(method = "lm", se = FALSE) +
  labs(title = "Scatter plot with linear fits", x = "X", y = "Y") +
  theme_minimal()

# ggsave("scatter.png", p, width = 6, height = 4)
