# Chick layer count

All four meshes use the same single atlas, round profile, unit model height, cubic Hermite DC, six Taubin passes, an isotropic Gaussian sigma of 0.03322405 scene units and a QEM budget of 1,600 triangles. The first three columns in the video change vertical layer count at 32 × 31 XY. The fourth also increases horizontal sampling. Only the untextured geometry was assessed.

The filenames give the requested horizontal resolution followed by the layer count. The saved stacks have XY dimensions of 32 × 31 or 64 × 62. Build the three additional stacks with the original atlas, the same round profile and height as the parent benchmark. The 32-layer control reuses ../stack. Run prepare.py from this directory using NumPy and Pillow, then run each YAML through the Stack3 pipeline runner.

The default single boundary sample was insufficient for the higher layer counts at fixed physical smoothing radius. Every condition, including the rebuilt 32-layer control, was given transparent exterior margins of at least four Gaussian standard deviations on every axis before extraction. Voxel pitch, orientation and world-space alignment were retained. Compare the baseline in this experiment to its own higher-resolution arms.

The metrics use the same mask and torso measurements as the preceding smoothing experiment. The front lower 16 percent IoU compares projected and reference silhouette masks within the bottom 16 percent of the fitted front panel. Mean IoU averages the four atlas views. Ground Z is the lowest exported vertex, in scene units. All meshes reopened in Blender as a single connected island with zero boundary edges and zero degenerate faces. The video shows all meshes rotating synchronously in 120 steps of 3 degrees.
