# Folder-tree UI prototype

Throwaway UI prototype for comparing three fixed-layout bookmark experiences on one route.

Run it from the repository root:

```sh
python3 -m http.server 4173 -d prototypes/folder-tree
```

Then open <http://localhost:4173/>. Switch variants with the floating bottom control, the Left and Right arrow keys, or the shareable `?variant=A`, `?variant=B`, and `?variant=C` URLs.

The prototype uses sample data and in-memory state only. It is not production code.
