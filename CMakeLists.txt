cmake_minimum_required(VERSION 3.16)
project(salt_lake_spectral_tower LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)

add_executable(spectral_tower
    src/main.cpp
    src/scene.cpp
    src/renderer.cpp
)

target_include_directories(spectral_tower PRIVATE src)
target_link_libraries(spectral_tower PRIVATE Threads::Threads)
target_compile_options(spectral_tower PRIVATE -O3 -ffast-math -Wall -Wextra -Wpedantic)
