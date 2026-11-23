cmake_minimum_required(VERSION 3.16)
project(crystal_deep_shadow LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(deep_shadow_core
    src/scene.cpp
    src/deep_shadow.cpp
    src/render.cpp
    src/validation.cpp
)
target_include_directories(deep_shadow_core PUBLIC src)
target_compile_options(deep_shadow_core PRIVATE
    -Wall -Wextra -Wpedantic
)

add_executable(deep_shadow src/main.cpp)
target_link_libraries(deep_shadow PRIVATE deep_shadow_core)
target_compile_options(deep_shadow PRIVATE
    -Wall -Wextra -Wpedantic
)

add_executable(core_tests tests/core_tests.cpp)
target_link_libraries(core_tests PRIVATE deep_shadow_core)
target_compile_options(core_tests PRIVATE
    -Wall -Wextra -Wpedantic
)

enable_testing()
add_test(NAME core_tests COMMAND core_tests)
