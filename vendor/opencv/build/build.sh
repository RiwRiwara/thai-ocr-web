#!/usr/bin/env bash
# Rebuilds vendor/opencv/opencv-ocr.mjs: OpenCV.js 5.0.0 with only core + imgproc (+ geometry and flann, which
# imgproc needs) and only the functions src/line-ocr.js calls. One file, WASM inside, SIMD on.
#
# Needs: Emscripten (emsdk, activated), CMake, Python 3 (OpenCV's own build tool is a Python script), Node,
# and an OpenCV 5.0.0 checkout:  git clone --depth 1 --branch 5.0.0 https://github.com/opencv/opencv.git
#
#   OPENCV_SRC=/path/to/opencv npm run build:opencv
#
# If src/line-ocr.js starts calling another OpenCV function, add its name to whitelist.json.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${OPENCV_SRC:?set OPENCV_SRC to an OpenCV 5.0.0 source checkout}"
BUILD="${BUILD_DIR:-$HERE/.build}"
mkdir -p "$BUILD"

# core_bindings.cpp says "using namespace cv::segmentation", a namespace that only exists when the whitelist
# pulls in the IntelligentScissors header. Declare it empty so a minimal whitelist compiles.
CB="$SRC/modules/js/src/core_bindings.cpp"
grep -q "namespace cv { namespace segmentation {} }" "$CB" || \
  sed -i.bak 's|^using namespace cv::segmentation;|namespace cv { namespace segmentation {} }\nusing namespace cv::segmentation;|' "$CB"

off=""
for m in 3d calib dnn features objdetect photo video stereo ptcloud; do off="$off --cmake_option=-DBUILD_opencv_$m=OFF"; done

python3 "$SRC/platforms/js/build_js.py" "$BUILD" \
  --build_wasm --simd \
  --config "$HERE/whitelist.json" \
  --cmake_option=-DBUILD_TESTS=OFF --cmake_option=-DBUILD_PERF_TESTS=OFF --cmake_option=-DBUILD_EXAMPLES=OFF \
  $off

node "$HERE/wrap.mjs" "$BUILD/bin/opencv.js" "$HERE/../opencv-ocr.mjs"
