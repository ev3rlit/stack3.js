"""Compare geometry from two saved stacks. Run with the 020 research dependencies."""
import sys
from pathlib import Path

import numpy as np
import trimesh
from vtkmodules.util.numpy_support import numpy_to_vtk, vtk_to_numpy
from vtkmodules.vtkCommonDataModel import vtkImageData
from vtkmodules.vtkFiltersCore import vtkContourFilter, vtkFlyingEdges3D
from vtkmodules.vtkFiltersGeneral import vtkDataSetTriangleFilter

previous = Path(__file__).resolve().parents[1] / "020-aircraft-rendering"
sys.path.insert(0, str(previous / "scripts"))
from common import read_stack
from measure import iou, stencil


def rectangles(mask):
    """Count the rectangles of a width-first greedy scan of one face plane."""
    pending = mask.copy()
    count = 0
    for row, col in zip(*np.nonzero(mask)):
        if not pending[row, col]:
            continue
        end = col + 1
        while end < pending.shape[1] and pending[row, end]:
            end += 1
        bottom = row + 1
        while bottom < pending.shape[0] and pending[bottom, col:end].all():
            bottom += 1
        pending[row:bottom, col:end] = False
        count += 1
    return count


def block_counts(padded):
    faces = greedy = 0
    for axis in range(3):
        transitions = np.diff(np.moveaxis(padded, axis, 0).astype(np.int8), axis=0)
        faces += np.count_nonzero(transitions)
        for plane in transitions:
            for facing in (-1, 1):
                greedy += rectangles(plane == facing)
    return 2 * faces, 2 * greedy


def compare(part):
    meta, tiles = read_stack(f"part-atlases/stacks/{part}")
    mask = tiles[..., 3] >= 128
    dims = np.array(mask.shape[::-1])
    pitch = np.array(meta["size"]) / dims
    pitch[2] = meta["spacing"]
    padded = np.pad(mask, 1)
    block, greedy = block_counts(padded)
    print(f"{part} exposed faces / greedy (triangles): {block} / {greedy}")

    field = vtkImageData()
    field.SetDimensions(*padded.shape[::-1])
    field.SetOrigin(*(-pitch / 2))
    field.SetSpacing(*pitch)
    field.GetPointData().SetScalars(numpy_to_vtk(padded.astype(np.float32).ravel(), deep=True))
    cubes = vtkFlyingEdges3D()
    cubes.SetInputData(field)
    tetrahedra = vtkDataSetTriangleFilter()
    tetrahedra.SetInputData(field)
    tetra = vtkContourFilter()
    tetra.SetInputConnection(tetrahedra.GetOutputPort())
    factor = 3
    reference = mask.repeat(factor, axis=0).repeat(factor, axis=1).repeat(factor, axis=2)
    for name, extractor in (("Flying Edges", cubes), ("tetrahedra", tetra)):
        extractor.SetValue(0, 0.5)
        extractor.Update()
        poly = extractor.GetOutput()
        cells = poly.GetPolys()
        offsets = vtk_to_numpy(cells.GetOffsetsArray())
        assert np.all(np.diff(offsets) == 3)
        faces = vtk_to_numpy(cells.GetConnectivityArray()).reshape(-1, 3)
        mesh = trimesh.Trimesh(vtk_to_numpy(poly.GetPoints().GetData()), faces, process=False)
        solid = stencil(mesh, pitch / (2 * factor), pitch / factor, dims * factor)
        print(f"{part} {name}: {len(faces)} triangles, stack IoU {iou(solid, reference):.5f}")


if __name__ == "__main__":
    for part_name in ("canard", "canopy"):
        compare(part_name)
