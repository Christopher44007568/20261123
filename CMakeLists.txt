cmake_minimum_required(VERSION 3.16)
project(offshore_clip_renderer LANGUAGES CXX)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(offshore_clip_renderer
    src/main.cpp
    src/scene.cpp
    src/renderer.cpp
    src/validate.cpp
)

target_include_directories(offshore_clip_renderer PRIVATE src)
target_compile_options(offshore_clip_renderer PRIVATE
    -Wall -Wextra -Wpedantic -Wshadow
)

if(CMAKE_BUILD_TYPE STREQUAL "Release")
    target_compile_options(offshore_clip_renderer PRIVATE -O3 -DNDEBUG)
endif()

enable_testing()
add_test(NAME renderer_self_check
    COMMAND offshore_clip_renderer --self-check)
