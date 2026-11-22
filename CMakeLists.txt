cmake_minimum_required(VERSION 3.16)
project(shelter_radiosity LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(shelter_radiosity
    src/main.cpp
    src/scene.cpp
    src/formfactor.cpp
    src/solver.cpp
    src/render.cpp
    src/report.cpp
)

if (MSVC)
    target_compile_options(shelter_radiosity PRIVATE /W4)
else()
    target_compile_options(shelter_radiosity PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
if (BUILD_TESTING)
    add_test(NAME shelter_radiosity_verify
             COMMAND shelter_radiosity --verify --no-export)
endif()
