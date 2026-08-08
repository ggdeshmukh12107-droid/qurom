// This file is part of Quorum, adapted from midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createTheme, alpha } from '@mui/material';

// Opaque rather than the upstream `alpha('#a8a8a8', 0.7)`. This colour carries
// the nullifier hex, the tally figures and the disclosure labels -- all small
// text -- and at 70% alpha it composited to 4.21:1 against the card, under the
// 4.5:1 that body-size text needs. Flattening the same grey to an opaque value
// keeps the look and clears the bar.
const midnightGrey = '#b9b9c6';

export const theme = createTheme({
  typography: {
    fontFamily: 'Helvetica',
  },
  palette: {
    // Dark mode is load-bearing here, not cosmetic. The app paints on black,
    // but the upstream theme forced every Typography to white while leaving
    // Card on the default light paper, so everything inside a card rendered
    // white-on-white -- the poll question, the tally and the whole privacy
    // panel included. In dark mode MUI derives paper, text, divider and
    // action.hover together, so surfaces and text stay in step.
    mode: 'dark',
    primary: {
      main: midnightGrey,
      light: alpha(midnightGrey, 0.5),
      // Carries the caption/secondary text. It has to stay legible against
      // background.paper rather than fading into it, so it is a flat colour
      // rather than another alpha pass over an already-transparent grey.
      dark: '#9e9eae',
    },
    secondary: {
      main: '#8c8c8c',
    },
    background: {
      default: '#000',
      paper: '#1b1b22',
    },
  },
});
