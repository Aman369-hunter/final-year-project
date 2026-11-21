"""Make the OpenMP runtime available to XGBoost on macOS without Homebrew.

The xgboost wheel's libxgboost.dylib links @rpath/libomp.dylib, but this machine
has no Homebrew libomp. We ship a copy under engine/.venv-ml/libomp/ (extracted
from the conda-forge llvm-openmp package) and preload it into the global symbol
namespace here, so dyld satisfies xgboost's dependency from the already-loaded
image. No environment variables, no binary patching. A no-op off macOS or when
the file is absent (e.g. a machine that has a system libomp).
"""
import ctypes
import os
import sys

_LIBOMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".venv-ml", "libomp", "libomp.dylib")


def ensure_openmp():
    if sys.platform != "darwin":
        return
    path = os.path.normpath(_LIBOMP)
    if os.path.exists(path):
        try:
            ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
        except OSError:
            pass
