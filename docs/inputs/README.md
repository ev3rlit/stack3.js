# Inputs and Alignment

Convert an atlas or individually supplied images into the same set of named orthographic views. The CLI and viewer share this input contract.

## Required Behavior

- Accept the four-view set `top`, `left`, `front`, and `rear`.
- Accept the six-view set by adding `right` and `bottom`.
- Assign atlas tiles using the declared layout. Preserve the assignment when a project is saved.
- Resolve each image in a CLI manifest relative to the manifest file.
- Read transparency or derive a silhouette from the background. Preserve the original image so the mask can be corrected.
- Make crop, image orientation, shared scale, and ground line inspectable. Report missing or duplicated directions, empty masks, and conflicting proportions.

The normalized result includes each view's image, silhouette mask, orientation, and alignment. This lets the reconstruction use consistent dimensions regardless of the input layout.

## Completion Check

Load a four-view atlas and its individual tiles. With the same crop, orientation, and scale settings, both yield equivalent masks and aligned dimensions. Import a six-view set and verify that the right side and bottom are assigned correctly.
