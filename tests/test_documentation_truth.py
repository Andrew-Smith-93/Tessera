import unittest
import os
import re
import json
import hashlib
import subprocess

TARGET_TOKEN = "ma" + "ster"
TARGET_RE = re.compile(rf"\b{TARGET_TOKEN}\b", re.IGNORECASE)

STATIC_PER_OCCURRENCE_REGISTRY = {
    ".github/workflows/ci.yml": {
        "category": "CI_WORKFLOW_TOOLCHAIN",
        "total_occurrences": 1,
        "lines": {
            "6e005a8bc2ac23f0026deb54a2286e986b1ce0fa12e6f2497d9329b69261c6da": {"occ": 1, "repeat": 1, "positions": [29]},
        }
    },
    "apps/kwin-adapter/src/index.ts": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 1,
        "lines": {
            "4866d265d40a7c6397d14eb78e8128d824263a6b266d29a802514afb23b6a1ff": {"occ": 1, "repeat": 1, "positions": [32]},
        }
    },
    "apps/kwin-adapter/src/qml-compat.ts": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 1,
        "lines": {
            "6e44ce7b436e8e95b60ec0c114924087b7fb42fa82c4198ce28ba6d48d3c4088": {"occ": 1, "repeat": 1, "positions": [101]},
        }
    },
    "apps/kwin-adapter/src/runtime-coordinator.ts": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 2,
        "lines": {
            "170fd9f7e4718c57127bccdc214d52cf9e7b6c04ab8b067bfb92b47763071a55": {"occ": 1, "repeat": 1, "positions": [285]},
            "b7f68df55a64bf310f69293f35cc51b53b83eab3bd3e5e6b52d86744397dc857": {"occ": 1, "repeat": 1, "positions": [1381]},
        }
    },
    "apps/kwin-adapter/src/screen-state.ts": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 5,
        "lines": {
            "2a4fafd2949e480f3525ea61e581ab5ea1088f7353d35247b0a3572ed4cf9d29": {"occ": 1, "repeat": 1, "positions": [68]},
            "39a7965157509333a5c169f5c04d34ed70a04a37be8266ba6a31859cd45c8723": {"occ": 1, "repeat": 1, "positions": [18]},
            "5b71625e1b1f91ca341c54db19b1f1f65d5092cec2a4a58f06a2fedfb43c2d2f": {"occ": 1, "repeat": 1, "positions": [35]},
            "b0e2b2cad83c78ad823e8ba990f2cc600d54b7b946a6ee3de537ddf74457db82": {"occ": 1, "repeat": 1, "positions": [69]},
            "fc163f5931e0c13536b99bcac8a4f71d7813b32c67e409790cb2a9b6d3bc447f": {"occ": 1, "repeat": 1, "positions": [78]},
        }
    },
    "apps/kwin-adapter/tests/qml-isolation.test.ts": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "55c592750437b2c8da865496325b79821faa1ef576c64f0fb032500654a61e3e": {"occ": 1, "repeat": 1, "positions": [34]},
        }
    },
    "apps/kwin-adapter/tests/qml-source-isolation.test.ts": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "e3c93f145a8773970fccee282a276ca80d7ccfdc4ea1d98ec7ce563af139df2b": {"occ": 1, "repeat": 1, "positions": [187]},
        }
    },
    "apps/kwin-adapter/tests/reconciler.test.ts": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 2,
        "lines": {
            "a5bdaae63a601bbd2ef015215e45922cc303dd31c3435fcc6846c4a2029a8b58": {"occ": 1, "repeat": 1, "positions": [116]},
            "b597ac023a6aea002988f811e4e046d53bf7720d9c410c2e17da249de0866b60": {"occ": 1, "repeat": 1, "positions": [48]},
        }
    },
    "apps/kwin-adapter/tests/scoped-slot-ordering.test.ts": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 3,
        "lines": {
            "122d87cd41dab8a2baf00739a7e196048e3b608e80cb6f29099b19e60c29b0ca": {"occ": 1, "repeat": 1, "positions": [369]},
            "b597ac023a6aea002988f811e4e046d53bf7720d9c410c2e17da249de0866b60": {"occ": 1, "repeat": 2, "positions": [50, 269]},
        }
    },
    "apps/runtime-simulator/README.md": {
        "category": "SIMULATOR_INTERNAL",
        "total_occurrences": 6,
        "lines": {
            "8219f53deb47a0d063da892a5f2f477e1aa944149a1eaeef2e463029806fb676": {"occ": 1, "repeat": 1, "positions": [45]},
            "8ebd71e7b6a105f8aebc0d1891a3e8e949b57b10639ee934a3650620b7faa43d": {"occ": 1, "repeat": 1, "positions": [95]},
            "a6e726af701e0192de044f8e88ea6ba4e3c30a1dbd524d88242c85ad188f6d1d": {"occ": 2, "repeat": 1, "positions": [68]},
            "fd8745b1edca0514a913a23f409398c6b8c1b30d58f8869cf073030685d4a125": {"occ": 2, "repeat": 1, "positions": [67]},
        }
    },
    "apps/runtime-simulator/fixtures/01-single-screen-three-windows.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 2,
        "lines": {
            "04dce4667df707ba064c9badc7c9c8383fa70a55621325ca00e83a8f17faf1ad": {"occ": 1, "repeat": 1, "positions": [4]},
            "da820705fb9503b80f5f667c21c691b7b83cf42202b430d40dace1a08946e82c": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/02-window-addition-removal.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    f"apps/runtime-simulator/fixtures/03-{TARGET_TOKEN}-count-ratio-change.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 6,
        "lines": {
            "56bc0c80841d1a4c1a0c1cbdd57139d37071a23c9dd5b4982f605198c40e8629": {"occ": 1, "repeat": 1, "positions": [3]},
            "5eabb5cab89edda350f46ae68ada02f3b897ee441747c860300c5f96d1360b21": {"occ": 2, "repeat": 1, "positions": [4]},
            "96f7096330f20ea0118bdce50cf2c3a96af46a13ab2b98fd04375d39866df9b7": {"occ": 1, "repeat": 1, "positions": [98]},
            "da820705fb9503b80f5f667c21c691b7b83cf42202b430d40dace1a08946e82c": {"occ": 1, "repeat": 1, "positions": [7]},
            "e01364ed4fcae956b12bf5d1c5d750dbadd0046d43630ff3449ceb3c56dba6f0": {"occ": 1, "repeat": 1, "positions": [106]},
        }
    },
    "apps/runtime-simulator/fixtures/04-minimize-and-restore.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/05-true-fullscreen-enter-exit.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/06-borderless-fullscreen-enter-exit.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/08-ordinary-steam-client-tiled.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/09-generic-wine-config-tiled.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/10-two-horizontal-outputs.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/11-output-negative-coordinates.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/12-vertically-stacked-outputs.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/13-differently-sized-outputs.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/14-panel-work-area-offset.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/15-window-migration-between-outputs.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/16-output-removal-reassignment.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/17-screen-geometry-change.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/18-hundred-coalesced-geometry-events.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/19-expected-geometry-echo.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "da820705fb9503b80f5f667c21c691b7b83cf42202b430d40dace1a08946e82c": {"occ": 1, "repeat": 1, "positions": [9]},
        }
    },
    "apps/runtime-simulator/fixtures/20-expired-geometry-echo.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "da820705fb9503b80f5f667c21c691b7b83cf42202b430d40dace1a08946e82c": {"occ": 1, "repeat": 1, "positions": [9]},
        }
    },
    "apps/runtime-simulator/fixtures/21-mismatched-external-geometry.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [8]},
        }
    },
    "apps/runtime-simulator/fixtures/22-cursor-movement-no-user-action.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/23-snap-preview-and-commit.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/24-config-revision-invalidation.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "da820705fb9503b80f5f667c21c691b7b83cf42202b430d40dace1a08946e82c": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/25-mixed-burst.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/negative/out-of-bounds.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/fixtures/negative/overlap.fixture.json": {
        "category": "SIMULATOR_FIXTURE",
        "total_occurrences": 1,
        "lines": {
            "9d4daf30741b380af8ac340c907e03520af8d20eba375c78b65cba1ffcdbd15a": {"occ": 1, "repeat": 1, "positions": [7]},
        }
    },
    "apps/runtime-simulator/goldens/01-single-screen-three-windows.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/02-window-addition-removal.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    f"apps/runtime-simulator/goldens/03-{TARGET_TOKEN}-count-ratio-change.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 3,
        "lines": {
            "2391dd3cb6cf067c7ec6a7d0dc1eaa5e194ca942f92d0cead59a42137cc7dfba": {"occ": 1, "repeat": 1, "positions": [29]},
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
            "f1aaec64940d9881a2a52886ac165ebd55e58586d016231635d04b9119c19bf4": {"occ": 1, "repeat": 1, "positions": [3]},
        }
    },
    "apps/runtime-simulator/goldens/04-minimize-and-restore.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/05-true-fullscreen-enter-exit.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/06-borderless-fullscreen-enter-exit.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/08-ordinary-steam-client-tiled.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/09-generic-wine-config-tiled.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/10-two-horizontal-outputs.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 67]},
        }
    },
    "apps/runtime-simulator/goldens/11-output-negative-coordinates.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 65]},
        }
    },
    "apps/runtime-simulator/goldens/12-vertically-stacked-outputs.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 65]},
        }
    },
    "apps/runtime-simulator/goldens/13-differently-sized-outputs.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 65]},
        }
    },
    "apps/runtime-simulator/goldens/14-panel-work-area-offset.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/15-window-migration-between-outputs.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 67]},
        }
    },
    "apps/runtime-simulator/goldens/16-output-removal-reassignment.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/17-screen-geometry-change.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/18-hundred-coalesced-geometry-events.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/19-expected-geometry-echo.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/20-expired-geometry-echo.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/21-mismatched-external-geometry.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/22-cursor-movement-no-user-action.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 1,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [36]},
        }
    },
    "apps/runtime-simulator/goldens/23-snap-preview-and-commit.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 65]},
        }
    },
    "apps/runtime-simulator/goldens/24-config-revision-invalidation.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 65]},
        }
    },
    "apps/runtime-simulator/goldens/25-mixed-burst.golden.json": {
        "category": "SIMULATOR_GOLDEN",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 2, "positions": [36, 68]},
        }
    },
    "apps/runtime-simulator/src/invariants.ts": {
        "category": "SIMULATOR_INTERNAL",
        "total_occurrences": 1,
        "lines": {
            "483d559e0af0acf8e3d78f97cadbfa9e4a8ff5c0b4f5998ef15460fbb92c05c2": {"occ": 1, "repeat": 1, "positions": [213]},
        }
    },
    "apps/runtime-simulator/src/simulator.ts": {
        "category": "SIMULATOR_INTERNAL",
        "total_occurrences": 2,
        "lines": {
            "847f6a0f7e078a62829d4f0548ae2245f09d74a751523b69fe0b1043e5e022c7": {"occ": 1, "repeat": 1, "positions": [303]},
            "ca02249745bad0ce76121dd90cb548bb60f0290a1a226b62c939ecb33d94008a": {"occ": 1, "repeat": 1, "positions": [313]},
        }
    },
    "apps/runtime-simulator/src/stress.ts": {
        "category": "SIMULATOR_INTERNAL",
        "total_occurrences": 4,
        "lines": {
            "1624c306fedb7a7ccb2d5f9ef5ac5ba8e1beca963364cc77182840990a22cd58": {"occ": 1, "repeat": 1, "positions": [114]},
            "b597ac023a6aea002988f811e4e046d53bf7720d9c410c2e17da249de0866b60": {"occ": 1, "repeat": 1, "positions": [147]},
            "e57af1686897db00499a00c5cd46a2e7eed1c02849a900ce16dadd63c4156be2": {"occ": 1, "repeat": 1, "positions": [109]},
            "e69340b9ef30722ec5c3cdedd41613e441ce00b5be15b0bfaf19ff9e68e9180c": {"occ": 1, "repeat": 1, "positions": [120]},
        }
    },
    "apps/runtime-simulator/src/types.ts": {
        "category": "SIMULATOR_INTERNAL",
        "total_occurrences": 2,
        "lines": {
            "432ac4f733c245e9ed6084fe95aeac910d4335dbf09aaa7e5107fdee0c46f42f": {"occ": 1, "repeat": 1, "positions": [25]},
            "db5be4bf18b27833ba24815f0dde152dbc62b8a724521c68e2397fe3de05859f": {"occ": 1, "repeat": 1, "positions": [26]},
        }
    },
    "apps/runtime-simulator/tests/simulator.test.ts": {
        "category": "SIMULATOR_INTERNAL",
        "total_occurrences": 4,
        "lines": {
            "0dc4d895e4a51eb85d7cf8d0aa75f09a26e642b05621f772f8f53ac69dd6ccb5": {"occ": 1, "repeat": 1, "positions": [467]},
            "5168602173f84f5e3d376fe63a02b3e8518dbe8b56834e4322d42228bdc98af3": {"occ": 1, "repeat": 3, "positions": [418, 457, 497]},
        }
    },
    "apps/tessera-daemon/src/backend.rs": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 1,
        "lines": {
            "4a15b1180c1ef4c11499e9e3bb9aa1a13d5ff415f3b4dbebef357d47ff22630b": {"occ": 1, "repeat": 1, "positions": [182]},
        }
    },
    "config/canonical-config.json": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 1,
        "lines": {
            "9fc1ca5c5d9526838449296b630d069531763ca69bb2a2d4d728bc02743c1cf8": {"occ": 1, "repeat": 1, "positions": [31]},
        }
    },
    "config/shortcuts.json": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 5,
        "lines": {
            "015aaebd822d99fbd692bd7bd723623e2162054b7bd4336603443f880dab842c": {"occ": 1, "repeat": 1, "positions": [32]},
            "8e0387c999f70597dcdb69290ef0aed40351d6cb194d8059ea5a89b3bc9ca066": {"occ": 1, "repeat": 1, "positions": [33]},
            "984bdce5e151006ac706e7c4e1340d5cad42118dea5326036fde0378285cba17": {"occ": 1, "repeat": 1, "positions": [29]},
            "cc7e001a2e8d41aa221552457bb355c66f916ed137cb479c51da8765c0f93c14": {"occ": 1, "repeat": 1, "positions": [31]},
            "e7e51b30b53fc2b70aa44635879f9984af0e8afb8c6b476688a60d87874a4220": {"occ": 1, "repeat": 1, "positions": [30]},
        }
    },
    "contents/code/layouts.js": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 2,
        "lines": {
            "3b2c23bcfaf8ab9172994c9f1e9fc482aa405294e9182ab8d5cef963b282d5c5": {"occ": 1, "repeat": 1, "positions": [302]},
            "a91b7098573060d5c8376df27bd940120b701c0f47f37308960d39ac4b5aef60": {"occ": 1, "repeat": 1, "positions": [411]},
        }
    },
    "contents/code/reconciler.js": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 3,
        "lines": {
            "3b2c23bcfaf8ab9172994c9f1e9fc482aa405294e9182ab8d5cef963b282d5c5": {"occ": 1, "repeat": 1, "positions": [314]},
            "570ee0074f90a904d28262d3f6060f6fcfc9d551f2689463077e629a97a1c17a": {"occ": 1, "repeat": 1, "positions": [1190]},
            "677495302d129c88935bcef077d1a30c86aa8a534ab3b75eed3cc1c614ee3698": {"occ": 1, "repeat": 1, "positions": [2109]},
        }
    },
    "contents/ui/main.qml": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 1,
        "lines": {
            "89af9378bf6cb43da12a01a6d24bf28b61fc851a003f9aefe8610966a4f16ab8": {"occ": 1, "repeat": 1, "positions": [135]},
        }
    },
    "docs/BASELINE_SETTINGS_DRIFT_MATRIX.md": {
        "category": "HISTORICAL_DOCUMENTATION",
        "total_occurrences": 6,
        "lines": {
            "26cc23fab6214d1dfaecb95e68253074a03817f35232cf4f617f8740e72cdd2a": {"occ": 3, "repeat": 1, "positions": [15]},
            "328a3e9bf0bf2c63f7dbbf77732a6669ed0ac8bae6cd688a987dee8d94574ec8": {"occ": 1, "repeat": 1, "positions": [56]},
            "8d1f0fe023dc070f19fb5d1be4296784d957dc690a4cbd1678bbb813d699a17c": {"occ": 1, "repeat": 1, "positions": [18]},
            "ff8ebe91d951065395624080cb8a7c044d000ca8326133af1592fcb8c0a04543": {"occ": 1, "repeat": 1, "positions": [19]},
        }
    },
    "docs/LIVE_KWIN_X11_ACCEPTANCE.md": {
        "category": "HISTORICAL_DOCUMENTATION",
        "total_occurrences": 4,
        "lines": {
            "43d3418e4e501490a2b3933578b149ef317476735b85ca0ebddb1503e046070e": {"occ": 2, "repeat": 1, "positions": [309]},
            "8203859cf90e317124ea5fc8b006e2ad85da86b22f8ee35e95fd62d1698d40a3": {"occ": 1, "repeat": 1, "positions": [72]},
            "c3f69653d993d4abe17073739b010a9747d91a7fc78fe21228076855ae2bebdc": {"occ": 1, "repeat": 1, "positions": [139]},
        }
    },
    "docs/PHASE_5D_RUNTIME_SETTINGS_REBUILD.md": {
        "category": "HISTORICAL_DOCUMENTATION",
        "total_occurrences": 3,
        "lines": {
            "8e0adedd540a20ab5b0eeba5a3cac9c31c58fe00495f7fcd2eda5ee97523af4d": {"occ": 1, "repeat": 1, "positions": [6]},
            "b2bd31d96943fe293a5ef6f9b212e5492a09b8c5d6086796a1258271c3499895": {"occ": 1, "repeat": 1, "positions": [98]},
            "bb6b8f9aef0edc559c05ac38c4673e2ff3c5138c059ac193051fcbc626a2a610": {"occ": 1, "repeat": 1, "positions": [38]},
        }
    },
    "docs/PHASE_5D_SECOND_PASS_AUDIT.md": {
        "category": "HISTORICAL_DOCUMENTATION",
        "total_occurrences": 5,
        "lines": {
            "380fba4b753f4b2b9ca7578b1ab2dcb0e01915b641f2a0142a0916bd004a0612": {"occ": 3, "repeat": 1, "positions": [48]},
            "9d4f26a1a2c89d55216277919603ed1f8131e39e520a70c2726e6c6208aff412": {"occ": 1, "repeat": 1, "positions": [127]},
            "cef44e192432e22ea654abbd8e1c66975a0eb132e1c1a43586a8e0a0cfc6a3dc": {"occ": 1, "repeat": 1, "positions": [51]},
        }
    },
    "docs/RUNTIME_ARCHITECTURE.md": {
        "category": "HISTORICAL_DOCUMENTATION",
        "total_occurrences": 4,
        "lines": {
            "1768870bbf2b1d94bea6a484219c8474d6a31082617ff995ae25d60d732c3982": {"occ": 1, "repeat": 1, "positions": [381]},
            "4f1a1bc429b022b4d27668d098620a3b69fc9b85b0efe1bd9befe2b636e5d703": {"occ": 1, "repeat": 1, "positions": [380]},
            "6b4b8d0b4140b6109b95ff25cd975836b7f4ed974fc2895f493354cf128d74d5": {"occ": 1, "repeat": 1, "positions": [298]},
            "808fc921dc235b488c512de4c195f7cf79e8cb63a0b711481694abc918622a44": {"occ": 1, "repeat": 1, "positions": [365]},
        }
    },
    "install.sh": {
        "category": "INSTALLER_REJECTION_CHECK",
        "total_occurrences": 3,
        "lines": {
            "17b2d80674cd4dce65cf7d863d70a11244c6cb1ce68b9f868a607766363b5088": {"occ": 1, "repeat": 1, "positions": [211]},
            "9c301d161a63e951b20cd75ec74c56effec3344d1dc2fd04a62cfeee3860790f": {"occ": 2, "repeat": 1, "positions": [210]},
        }
    },
    "packages/layout-core/src/solver.ts": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 3,
        "lines": {
            "be06093cdfc1d3ec650590ef320c8ffae4e73b6ae9b8223691625ba6ca4aa73b": {"occ": 1, "repeat": 1, "positions": [290]},
            "c8663605a8495ecaaf77cbd66637b405d5c4bcd0e509959c33482753a528ed00": {"occ": 1, "repeat": 1, "positions": [16]},
            "d247b8e910f4c9c6d6352309ca85c267d1e58430a80d99709d23136cb739e126": {"occ": 1, "repeat": 1, "positions": [160]},
        }
    },
    "packages/layout-core/tests/solver.test.ts": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 2,
        "lines": {
            "2f9ccdcf8009cde94dcd287fe94046b9e427cd69d6b69e72641f317d4d67e22b": {"occ": 1, "repeat": 1, "positions": [152]},
            "7ed6a1acf661f1f39ba0320031e10945b7ab0a0744df21f08236048dd7c5d714": {"occ": 1, "repeat": 1, "positions": [135]},
        }
    },
    "packages/protocol/fixtures/valid/05-state-get-snapshot-response.json": {
        "category": "FROZEN_PROTOCOL_V1",
        "total_occurrences": 2,
        "lines": {
            "24b2075aee12aba7e5b20890e274e516fa4cc17f4dd7ffcffe7fefad039b1d52": {"occ": 1, "repeat": 1, "positions": [17]},
            "510aa12182e81b8ed8086d3c6f1fca528d3a65a7a0a65b39ae93178a371335e9": {"occ": 1, "repeat": 1, "positions": [45]},
        }
    },
    "packages/protocol/fixtures/valid/10-runtime-set-layout-request.json": {
        "category": "FROZEN_PROTOCOL_V1",
        "total_occurrences": 1,
        "lines": {
            "fb5efc52737caae42d2873b0d5079e6b0275ba61cab0c8102d2e80aebc7d6d00": {"occ": 1, "repeat": 1, "positions": [10]},
        }
    },
    "packages/protocol/src/commands.ts": {
        "category": "FROZEN_PROTOCOL_V1",
        "total_occurrences": 1,
        "lines": {
            "17ee4d3d2de58cef506c2ac9f7b5b93cd40b84ad9b6dd3e40a2f189f134170b8": {"occ": 1, "repeat": 1, "positions": [6]},
        }
    },
    "packages/protocol/tests/behavioral-conformance.test.ts": {
        "category": "FROZEN_PROTOCOL_V1",
        "total_occurrences": 2,
        "lines": {
            "5168602173f84f5e3d376fe63a02b3e8518dbe8b56834e4322d42228bdc98af3": {"occ": 1, "repeat": 1, "positions": [39]},
            "b597ac023a6aea002988f811e4e046d53bf7720d9c410c2e17da249de0866b60": {"occ": 1, "repeat": 1, "positions": [24]},
        }
    },
    "packages/protocol/tests/conformance.test.ts": {
        "category": "FROZEN_PROTOCOL_V1",
        "total_occurrences": 1,
        "lines": {
            "bf228d4472599ceb5257cff75610bc8a6a72980330e58df0c115841184945b62": {"occ": 1, "repeat": 1, "positions": [63]},
        }
    },
    "packages/protocol/tests/endpoint.test.ts": {
        "category": "FROZEN_PROTOCOL_V1",
        "total_occurrences": 4,
        "lines": {
            "5168602173f84f5e3d376fe63a02b3e8518dbe8b56834e4322d42228bdc98af3": {"occ": 1, "repeat": 1, "positions": [39]},
            "b597ac023a6aea002988f811e4e046d53bf7720d9c410c2e17da249de0866b60": {"occ": 1, "repeat": 1, "positions": [25]},
            "bf228d4472599ceb5257cff75610bc8a6a72980330e58df0c115841184945b62": {"occ": 1, "repeat": 2, "positions": [437, 576]},
        }
    },
    "packages/protocol/tests/validation.test.ts": {
        "category": "FROZEN_PROTOCOL_V1",
        "total_occurrences": 1,
        "lines": {
            "fa58ed7dbcb5f76789f480c0caabb4b13f41fdccb386f7bc8c7b8e6939c906c0": {"occ": 1, "repeat": 1, "positions": [173]},
        }
    },
    "tessera-control/config_contract.py": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 2,
        "lines": {
            "2b4c5f024e2b7362e0f66f8c3ebe24d7dd1d1fcea2a24baa0120186f96245d9f": {"occ": 1, "repeat": 1, "positions": [137]},
            "b59bf5b3d09605bd02f3ceb2d5c0fdb94daf93dd4c40e9f8389104d764dd6be4": {"occ": 1, "repeat": 1, "positions": [32]},
        }
    },
    "tessera-control/ui_preview.py": {
        "category": "LEGACY_COMPATIBILITY",
        "total_occurrences": 6,
        "lines": {
            "2e6431804029cc44fc7a93edd290da5e4256cbafed888ef2311d7cb77a9aee03": {"occ": 1, "repeat": 1, "positions": [4]},
            "6bd33b963d4bfe067a66b9d4c9d7a7e9d99f95ee6c789a5ce5ac211ec0abbab0": {"occ": 1, "repeat": 1, "positions": [137]},
            "907a91211dd9a866a8e0196f3f071e347c6bb4dc8b266039378ec5fa0bd03ca4": {"occ": 1, "repeat": 1, "positions": [15]},
            "a080368c72b34ac0618b744b264783b07149fcbddea25a6238b67e1c82a2ae59": {"occ": 1, "repeat": 1, "positions": [183]},
            "a09db0bf8ac940df2b6b5c4f1c552731e2182b551faa6d863136bc1432df9afa": {"occ": 1, "repeat": 1, "positions": [269]},
            "af7ae5008f74e490cefd386bb9be30a011f454545edcb41d250e3f4d4cdd4713": {"occ": 1, "repeat": 1, "positions": [50]},
        }
    },
    "tests/fixtures/workspace-layouts-corpus.json": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 4,
        "lines": {
            "33c03fba7379e6b6825cd595117da19bb6d8fc8d75bc8ad3e0de5eecfc387b6f": {"occ": 1, "repeat": 1, "positions": [85]},
            "c3293cd3a19c24616b2644ebb23e2e6b015ba6409723963b9058080cace19e49": {"occ": 1, "repeat": 1, "positions": [378]},
            "e0de96fa89ef9fbddb56ca04f387f370e294cda661522db35e3ed2d44ef60458": {"occ": 1, "repeat": 1, "positions": [379]},
            "e7fb8e0f9cc4a1f31fa175996130464936ac48cfa15e537df7bf168bd2099efd": {"occ": 1, "repeat": 1, "positions": [86]},
        }
    },
    "tests/test_config_manager.py": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 2,
        "lines": {
            "4a15b1180c1ef4c11499e9e3bb9aa1a13d5ff415f3b4dbebef357d47ff22630b": {"occ": 1, "repeat": 1, "positions": [237]},
            "59500e0f25e6bedef284f712d4eb75f87f8a717384c83676232c973ccd08f65b": {"occ": 1, "repeat": 1, "positions": [379]},
        }
    },
    "tests/test_config_ui_bindings.py": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 3,
        "lines": {
            "11cff64dfc21ea938055ee440bfe879833411cfb4532a442abbfe2d28de35c98": {"occ": 1, "repeat": 1, "positions": [383]},
            "3f0ccfbc11dd870c41837872ffcb39b7f74a5561f2ce790d5fb1c90b96d8e73f": {"occ": 1, "repeat": 1, "positions": [384]},
            "dfe5a2f4a85c3bb34b21a40d550cbf69a39a4caa91eb3a422b0a98280537f6de": {"occ": 1, "repeat": 1, "positions": [379]},
        }
    },
    "tests/test_installer_integration.py": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 5,
        "lines": {
            "1eeea19856cd52ac7c55b07e5247923b8257618f165de475d41841caa5458254": {"occ": 1, "repeat": 1, "positions": [534]},
            "35e289c92826b7fa9f7866d5a77834465452c87ec1a67544b25f7984fa56121f": {"occ": 1, "repeat": 1, "positions": [530]},
            "4b753d791829cef7071471cb811b2d92bf362c49fda2d20a8b24f0ed33569062": {"occ": 1, "repeat": 1, "positions": [901]},
            "a32314ac4378fd66ad57ed6b3d87df7fc384b6c6a7809e2c0f62b9d4d20ddb37": {"occ": 1, "repeat": 1, "positions": [888]},
            "a5b487659d82472453e661f83a13fb2f2c38d89450617821109b6dacc411daf2": {"occ": 1, "repeat": 1, "positions": [900]},
        }
    },
    "tests/test_package_manifest.py": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 2,
        "lines": {
            "b38f86bd2705a4f2b632cba36eff0756069d7bab65f651f4fe09018b03857dd7": {"occ": 1, "repeat": 1, "positions": [494]},
            "ee1f7dcb880f79f2cec9353f4a0fe11d598da16329434e20c274acfe3a61862d": {"occ": 1, "repeat": 1, "positions": [482]},
        }
    },
    "tests/test_shortcut_contract.py": {
        "category": "TEST_ASSERTION_OR_FIXTURE",
        "total_occurrences": 5,
        "lines": {
            "446279d7865c2d49c02df98f724e61698f4a64912cfa69b0854f1c83e562092b": {"occ": 1, "repeat": 1, "positions": [29]},
            "5e2ac1b2114621acd459b50fc8b61277a098d2cce81400df8749e69d21bb8f4a": {"occ": 2, "repeat": 1, "positions": [63]},
            "e959a76b4646a0e2b3cb5d6cd929af784fc501f7271a948e9aff5e6a92f962ea": {"occ": 2, "repeat": 1, "positions": [64]},
        }
    },
    "uninstall.sh": {
        "category": "UNINSTALLER_LEGACY_PURGE",
        "total_occurrences": 5,
        "lines": {
            "8e0387c999f70597dcdb69290ef0aed40351d6cb194d8059ea5a89b3bc9ca066": {"occ": 1, "repeat": 1, "positions": [94]},
            "ace0320b95684ad13f436e8f0f76a9e06b137575984318612e9bde3f8c16fe8c": {"occ": 1, "repeat": 1, "positions": [93]},
            "c3af88f6516e3880592b703d6d1ce169908026bfa51668f752db521666bdc84b": {"occ": 1, "repeat": 1, "positions": [92]},
            "e0dd846fc4300b597c9be647b033c7aef7c18319a72c5d168e78d50093a41ba5": {"occ": 1, "repeat": 1, "positions": [90]},
            "ec6548777e9e0bc90cdec30eaf0f79b85e30e667aea20651abe68aec08f4f663": {"occ": 1, "repeat": 1, "positions": [91]},
        }
    },
}

def classify_candidate_file_hits(relpath, lines, registry):
    """
    Classifies and validates lines in a candidate file against the static registry.
    Returns a list of violation strings.
    """
    violations = []
    file_hit_hashes = {}
    file_hit_occurrences = 0

    for idx, line in enumerate(lines):
        hits = list(TARGET_RE.finditer(line))
        if hits:
            line_count = len(hits)
            line_no = idx + 1
            file_hit_occurrences += line_count
            line_hash = hashlib.sha256(line.encode("utf-8")).hexdigest()
            if line_hash not in file_hit_hashes:
                file_hit_hashes[line_hash] = {
                    "count": 1,
                    "line_occ": line_count,
                    "positions": [line_no],
                    "sample_line": line
                }
            else:
                file_hit_hashes[line_hash]["count"] += 1
                file_hit_hashes[line_hash]["positions"].append(line_no)

    if not file_hit_hashes:
        return violations

    if relpath not in registry:
        violations.append(
            f"{relpath}: unallowed file contains {file_hit_occurrences} target occurrences"
        )
        return violations

    expected_rule = registry[relpath]
    if file_hit_occurrences != expected_rule["total_occurrences"]:
        violations.append(
            f"{relpath}: total occurrences mismatch: expected {expected_rule['total_occurrences']}, got {file_hit_occurrences}"
        )

    expected_lines = expected_rule["lines"]
    for h, info in file_hit_hashes.items():
        if h not in expected_lines:
            violations.append(
                f"{relpath}: unexpected line hash {h} for line: [{info['sample_line']}]"
            )
        else:
            if info["line_occ"] != expected_lines[h]["occ"]:
                violations.append(
                    f"{relpath}: line occurrences mismatch for hash {h}: expected {expected_lines[h]['occ']}, got {info['line_occ']}"
                )
            if info["count"] != expected_lines[h]["repeat"]:
                violations.append(
                    f"{relpath}: line repeat count mismatch for hash {h}: expected {expected_lines[h]['repeat']}, got {info['count']}"
                )
            if sorted(info["positions"]) != sorted(expected_lines[h]["positions"]):
                violations.append(
                    f"{relpath}: line positions mismatch for hash {h}: expected {expected_lines[h]['positions']}, got {info['positions']}"
                )

    for h in expected_lines:
        if h not in file_hit_hashes:
            violations.append(f"{relpath}: missing expected line with hash {h}")

    return violations


class TestDocumentationTruth(unittest.TestCase):
    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    def _read_file(self, relpath):
        fullpath = os.path.join(self.repo_root, relpath)
        self.assertTrue(os.path.exists(fullpath), f"File {relpath} must exist")
        with open(fullpath, "r", encoding="utf-8") as f:
            return f.read()

    def test_phase_5b_report_remains_explicitly_historical(self):
        """
        Asserts docs/LIVE_KWIN_X11_ACCEPTANCE.md remains explicitly historical
        and does not claim Phase 5D current live acceptance.
        """
        content = self._read_file("docs/LIVE_KWIN_X11_ACCEPTANCE.md")
        self.assertIn("Historical Notice (Phase 5B Acceptance Baseline)", content)
        self.assertIn("Phase 5B", content)
        self.assertIn("Live interactive desktop re-verification on an active KWin session is a future live gate reserved for Omega", content)
        self.assertNotIn("Phase 5D Live Acceptance PASS", content)
        self.assertNotIn("Phase 5D Live PASS", content)

    def test_phase_5d_correction_docs_state_live_gates_not_run(self):
        """
        Asserts Phase 5D correction documents explicitly record that live KWin/KCM/Wayland
        and game/hotplug gates remain NOT RUN where applicable.
        """
        audit_content = self._read_file("docs/PHASE_5D_SECOND_PASS_AUDIT.md")
        self.assertIn("Automated evidence does not replace live KWin/KCM acceptance; that gate remains **NOT RUN** on this branch", audit_content)
        self.assertIn("Wayland", audit_content)
        self.assertIn("game window policy", audit_content)
        self.assertIn("multi-monitor hotplug", audit_content)

        rebuild_content = self._read_file("docs/PHASE_5D_RUNTIME_SETTINGS_REBUILD.md")
        self.assertIn("Live Session Installation & Verification (NOT RUN)", rebuild_content)
        self.assertIn("Wayland", rebuild_content)
        self.assertIn("game window policy", rebuild_content)
        self.assertIn("multi-monitor hotplug", rebuild_content)

    def test_public_claims_truth_in_readme_metadata_desktop_and_package(self):
        """
        Asserts current README, metadata.json, desktop entry, and package.sh contain
        no present-tense store availability, GPU-vendor optimization, AUR/release availability,
        or automated-as-live claims.
        """
        readme = self._read_file("README.md")
        self.assertNotIn("Available on KDE Store", readme)
        self.assertNotIn("Install from KDE Store", readme)
        self.assertIn("Store publication, AUR availability, and release upload are separate maintainer actions and are not claimed by this repository state", readme)

        self.assertNotIn("GPU-optimized", readme)
        self.assertNotIn("NVIDIA optimizations", readme)
        self.assertNotIn("nvidia", readme.lower())

        self.assertNotIn("Download from AUR", readme)
        self.assertNotIn("Available in AUR", readme)

        self.assertIn("Verification & Acceptance Scope", readme)
        self.assertIn("Historical Phase 5B Evidence", readme)
        self.assertIn("Live Gates (NOT RUN in Current Phase)", readme)

        meta_content = self._read_file("metadata.json")
        meta = json.loads(meta_content)
        meta_desc = meta.get("KPlugin", {}).get("Description", "")
        self.assertNotIn("GPU-optimized", meta_desc)
        self.assertNotIn("NVIDIA", meta_desc)
        self.assertNotIn("nvidia", meta_desc.lower())

        desktop_content = self._read_file("desktop/org.kde.tessera.desktop")
        self.assertNotIn("nvidia", desktop_content.lower())
        self.assertNotIn("NVIDIA", desktop_content)

        package_content = self._read_file("package.sh")
        self.assertNotIn("Ready for upload to https://store.kde.org", package_content)
        self.assertIn("Publication/upload remains a separate maintainer decision", package_content)

    def test_publication_guide_is_conditional_and_parameterized(self):
        """
        Asserts docs/KDE_STORE_PUBLISHING.md is an explicit maintainer checklist,
        derives or parameterizes the package filename, and does not claim publication or GPU marketing.
        """
        pub_content = self._read_file("docs/KDE_STORE_PUBLISHING.md")
        self.assertIn("This is a maintainer checklist, not evidence that Tessera has been published", pub_content)
        self.assertIn("dist/tessera-v<Version>.kwinscript", pub_content)
        self.assertNotIn("GPU-optimized", pub_content)
        self.assertNotIn("NVIDIA", pub_content)
        self.assertNotIn("nvidia", pub_content.lower())

    def test_historical_audit_and_drift_snapshots_reference_current_authority(self):
        """
        Asserts historical snapshot documents contain prominent notices and point
        current authority to PHASE_5D_SECOND_PASS_AUDIT.md.
        """
        pre_pub = self._read_file("docs/PRE_PUBLICATION_AUDIT.md")
        self.assertIn("Historical Audit Snapshot", pre_pub)
        self.assertIn("PHASE_5D_SECOND_PASS_AUDIT.md", pre_pub)

        drift = self._read_file("docs/BASELINE_SETTINGS_DRIFT_MATRIX.md")
        self.assertIn("Historical Baseline Snapshot", drift)
        self.assertIn("PHASE_5D_SECOND_PASS_AUDIT.md", drift)

    def test_active_user_facing_surfaces_contain_no_primary_predecessor_terminology(self):
        """
        Asserts active user-facing files (README.md, main.qml shortcuts/overlay/OSD,
        metadata.json, desktop entry, config.ui, settings descriptions, package.sh)
        contain no active predecessor terminology for primary panes.
        """
        # 1. README.md
        readme = self._read_file("README.md")
        self.assertIsNone(
            TARGET_RE.search(readme),
            f"README.md must not contain any {TARGET_TOKEN} terminology"
        )

        # 2. contents/ui/main.qml
        qml = self._read_file("contents/ui/main.qml")

        # 2a. Active shortcuts
        sc_blocks = re.findall(r"ShortcutHandler\s*\{([^}]+)\}", qml)
        self.assertEqual(len(sc_blocks), 23, "Expected exactly 23 ShortcutHandler blocks in main.qml")
        for sc in sc_blocks:
            self.assertIsNone(
                TARGET_RE.search(sc),
                f"ShortcutHandler block must not contain target terminology: {sc}"
            )

        # 2b. Visual snap overlay zones: title, badge, desc
        zone_blocks = re.findall(r"zones\.push\(\s*\{([\s\S]*?)\}\s*\);", qml)
        self.assertEqual(len(zone_blocks), 7, "Expected exactly 7 overlay zone definitions in main.qml")
        for z in zone_blocks:
            title_m = re.search(r'title:\s*"([^"]+)"', z)
            badge_m = re.search(r'badge:\s*"([^"]+)"', z)
            desc_m = re.search(r'desc:\s*"([^"]+)"', z)
            self.assertIsNotNone(title_m, f"Zone missing title: {z}")
            self.assertIsNotNone(badge_m, f"Zone missing badge: {z}")
            self.assertIsNotNone(desc_m, f"Zone missing desc: {z}")

            title = title_m.group(1)
            badge = badge_m.group(1)
            desc = desc_m.group(1)

            self.assertIsNone(TARGET_RE.search(title), f"Overlay zone title contains target terminology: {title}")
            self.assertIsNone(TARGET_RE.search(badge), f"Overlay zone badge contains target terminology: {badge}")
            self.assertIsNone(TARGET_RE.search(desc), f"Overlay zone desc contains target terminology: {desc}")

        # 2c. OSD notifications
        osd_calls = re.findall(r"(?:osdCall\.notify|showOsd)\s*\(([^;]+)\);", qml)
        self.assertGreaterEqual(len(osd_calls), 5, "Expected OSD notification calls in main.qml")
        for osd in osd_calls:
            self.assertIsNone(
                TARGET_RE.search(osd),
                f"OSD notification string must not contain target terminology: {osd}"
            )

        # 3. metadata.json
        meta_content = self._read_file("metadata.json")
        self.assertIsNone(
            TARGET_RE.search(meta_content),
            "metadata.json must not contain target terminology"
        )

        # 4. desktop/org.kde.tessera.desktop
        desktop_content = self._read_file("desktop/org.kde.tessera.desktop")
        self.assertIsNone(
            TARGET_RE.search(desktop_content),
            "desktop file must not contain target terminology"
        )

        # 5. contents/ui/config.ui visible string tags
        config_ui = self._read_file("contents/ui/config.ui")
        string_matches = re.findall(r"<string>([^<]+)</string>", config_ui)
        self.assertGreater(len(string_matches), 5, "Expected string elements in config.ui")
        for text in string_matches:
            self.assertIsNone(
                TARGET_RE.search(text),
                f"Visible string in config.ui must not contain target terminology: {text}"
            )

        # 6. tessera-control/tessera_settings.py card descriptions
        settings_code = self._read_file("tessera-control/tessera_settings.py")
        self.assertNotIn(f"dominant {TARGET_TOKEN}", settings_code.lower())
        self.assertNotIn(f"{TARGET_TOKEN} count", settings_code.lower())
        self.assertNotIn(f"{TARGET_TOKEN} ratio", settings_code.lower())

        # 7. package.sh user-facing echo output
        package_content = self._read_file("package.sh")
        for line in package_content.splitlines():
            if line.strip().startswith("echo"):
                self.assertIsNone(
                    TARGET_RE.search(line),
                    f"package.sh echo must not contain target terminology: {line}"
                )

        # 8. config/shortcuts.json active entries
        shortcuts_data = json.loads(self._read_file("config/shortcuts.json"))
        for s in shortcuts_data.get("shortcuts", []):
            name = s.get("name", "")
            label = s.get("label", "")
            self.assertIsNone(
                TARGET_RE.search(name),
                f"Active shortcut name '{name}' must not contain target terminology"
            )
            self.assertIsNone(
                TARGET_RE.search(label),
                f"Active shortcut label '{label}' must not contain target terminology"
            )

    def test_machine_readable_per_occurrence_line_hash_registry(self):
        """
        Machine-readable per-occurrence static line hash and position registry validation.
        Scans all candidate files (including this test file) and reconciles exact counts,
        exact UTF-8 line hashes, and exact 1-based line positions.
        """
        try:
            output = subprocess.check_output(
                ["git", "ls-files", "-co", "--exclude-standard"],
                cwd=self.repo_root,
                text=True,
                stderr=subprocess.DEVNULL
            )
            candidate_files = [f.strip() for f in output.splitlines() if f.strip()]
        except Exception as e:
            self.fail(f"git ls-files failed: {e}")

        banned_path_components = {
            "node_modules", "target", "dist", "build", "coverage", "__pycache__", ".pytest_cache", "caches", ".git"
        }

        total_hits = 0
        violations = []
        scanned_files_with_hits = set()

        for relpath in sorted(candidate_files):
            parts = set(relpath.split("/"))
            if parts & banned_path_components:
                continue

            fullpath = os.path.join(self.repo_root, relpath)
            if os.path.islink(fullpath) or not os.path.isfile(fullpath):
                continue

            try:
                with open(fullpath, "rb") as bf:
                    raw_bytes = bf.read()
            except Exception:
                continue

            if b"\x00" in raw_bytes:
                continue

            try:
                content = raw_bytes.decode("utf-8")
            except UnicodeDecodeError:
                continue

            lines = content.splitlines()
            file_violations = classify_candidate_file_hits(relpath, lines, STATIC_PER_OCCURRENCE_REGISTRY)
            if file_violations:
                violations.extend(file_violations)

            # Count total occurrences
            file_hits = sum(len(list(TARGET_RE.finditer(line))) for line in lines)
            if file_hits > 0:
                total_hits += file_hits
                scanned_files_with_hits.add(relpath)

        # 1. Assert exact current totals: exactly 191 occurrences across 95 files
        self.assertEqual(
            total_hits, 191,
            f"Expected exactly 191 target occurrences across candidate files, found {total_hits}"
        )
        self.assertEqual(
            len(scanned_files_with_hits), 95,
            f"Expected exactly 95 files with target occurrences, found {len(scanned_files_with_hits)}"
        )

        # 2. Reconcile missing or extra files in registry
        missing_files = set(STATIC_PER_OCCURRENCE_REGISTRY.keys()) - scanned_files_with_hits
        if missing_files:
            violations.append(f"Registry files missing expected occurrences: {missing_files}")

        self.assertEqual(violations, [], "Per-occurrence line hash registry violations:\n" + "\n".join(violations))

    def test_static_registry_mutation_probes_reject_unallowed_changes(self):
        """
        Unit-level negative sentinel invoking classify_candidate_file_hits:
        (a) an unallowed new file containing target token
        (b) an allowed historical path where an approved hit line is replaced by an arbitrary
            user-facing target line while holding total count constant
        (c) an allowed historical path where an approved hit line is moved to a different line
            position while keeping line bytes and total count constant.
        All three must be rejected.
        """
        # Probe (a): unallowed new file
        lines_a = [
            "import QtQuick",
            f'Text {{ text: "Visible {TARGET_TOKEN.title()} View"; }}'
        ]
        violations_a = classify_candidate_file_hits("contents/ui/NewComponent.qml", lines_a, STATIC_PER_OCCURRENCE_REGISTRY)
        self.assertTrue(len(violations_a) > 0, "Probe (a) failed: expected unallowed file to be rejected")
        self.assertTrue(any("unallowed file" in v for v in violations_a))

        # Probe (b): allowed historical path with substituted user-facing line (count held constant)
        target_path = "docs/RUNTIME_ARCHITECTURE.md"
        real_lines = self._read_file(target_path).splitlines()

        mutated_lines_b = []
        replaced = False
        for line in real_lines:
            if not replaced and TARGET_RE.search(line):
                # Replace approved line with an arbitrary user-facing line containing exactly one target token
                mutated_lines_b.append(f"Visible {TARGET_TOKEN.title()} Control Center")
                replaced = True
            else:
                mutated_lines_b.append(line)

        self.assertTrue(replaced, "Failed to find line to mutate in test fixture")
        violations_b = classify_candidate_file_hits(target_path, mutated_lines_b, STATIC_PER_OCCURRENCE_REGISTRY)
        self.assertTrue(len(violations_b) > 0, "Probe (b) failed: expected substituted line to be rejected by hash check")
        self.assertTrue(
            any("unexpected line hash" in v or "missing expected line" in v for v in violations_b),
            f"Expected line hash mismatch, got: {violations_b}"
        )

        # Probe (c): allowed historical path with moved line position (count and bytes held constant)
        mutated_lines_c = list(real_lines)
        line_298 = mutated_lines_c[297]  # 0-indexed 297 is line 298
        # Swap line 1 (index 0) with line 298 (index 297)
        mutated_lines_c[297] = mutated_lines_c[0]
        mutated_lines_c[0] = line_298
        violations_c = classify_candidate_file_hits(target_path, mutated_lines_c, STATIC_PER_OCCURRENCE_REGISTRY)
        self.assertTrue(len(violations_c) > 0, "Probe (c) failed: expected moved line to be rejected by position check")
        self.assertTrue(
            any("line positions mismatch" in v for v in violations_c),
            f"Expected line positions mismatch, got: {violations_c}"
        )


if __name__ == "__main__":
    unittest.main()
