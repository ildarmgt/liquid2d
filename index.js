const SIZE = 40 // # of cells per side
const WIDTH = 1000 // px height and width

const MAX_FRAME_RATE = 60
const RELAX = 0.964
const RANDOMNESS_INITIAL = 0.9
const RANDOM_NOISE = 1e-3 // on pressure

const RECALC_TIMES = 1

const SHOW_FLOW = true
const VECTOR_LENGTH = 50
const VECTOR_LINE_WIDTH = (WIDTH / SIZE / 5) | 0

const USE_MOUSE = true
const MOUSE_RADIUS = WIDTH / 6

const DELTA_T = 1
const DENSITY = 1
const VISCOCITY = 1e-3

const PRIMARY_CORRECTION = 0.75 // from vx and dpdx
const SECONDARY_CORRECTION = 0.25 // from P
const TERNARY_CORRECTION = 0.27 // from dp/dt and vx

const CUSTOM_FIELD = false
const CUSTOM_FIELD_X = -0.8
const CUSTOM_FIELD_Y = 0.05

//  testing
const SHOW_PRESSURE = false
const SQUARE_SIZE = 9
const PRESSURE_BUILDUP = true
const WALLS_ON = true

const FORCE_X = 0.0
const FORCE_Y = 0.0

/* Basic equation

  i is x or y, j is the other one then
  xi is length in either x or y direction, xj is length in the other direction
  vi velocity in i direction so vx in x direction or vy in y direction
  shearij is tensor in ij plane
  d/dxi P - derivative of pressure in xi direction, called dpdx and dpdy
  @ n: at current time
  @ n+1: at time after calc step
  assume DENSITY doesn't change w/ time or position

  abbreviation:
  Hi = d/dxj * (shearij) - d/dx (DENSITY * vj * vi)
  shearij = VISCOCITY * (d/dxj vi + d/dxi vj)

  navier stokes momentum eq for direction i:
  d/dt (DENSITY * vi) + d/dxj (DENSITY * vj * vi) = d/dxj shearij - d/dxi P
  d/dt * vi ~ (vi @ n+1 - vi @ n) / DELTA_T

  add the vi equation for both vx and vy directions together
  take partial derivative of it in d/dx direction and d/dy direction

  d/dx vx + d/dy vy = 0
  according to incompressible mass balance continuity
  which cancels out all d/dxi vi terms for both n and n+1

  d/dxi d/dxi P @ n ~ dHi/dxi @ n

  so integrate both sides from reference position to position
  to estimate d/dxi P

  d/dxi P ~ d/dxi (P)_atrefxi +  Hi - Hi_atrefxi :  all @ n

  then use d/dxi P to get vi @ n + 1
  vi @ n+1 = vi @ n + DELTA_T / DENSITY * (Hxi - d/dxi P)

*/

const mouse = {
  x: -2 * MOUSE_RADIUS,
  y: -2 * MOUSE_RADIUS,
  oldx: -2 * MOUSE_RADIUS,
  oldy: -2 * MOUSE_RADIUS,
  oldx2: -2 * MOUSE_RADIUS,
  oldy2: -2 * MOUSE_RADIUS,
  angle: 0,
  clicked: false
}

// state
const st = (data = null) => {
  // values for filling cells and unindexed cells beyond borders
  // bunch of unused values for now for testing stuff
  const EMPTY = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dpdx: 0,
    dpdy: 0,
    Hx: 0,
    Hy: 0,
    shearx: 0,
    sheary: 0,
    ddx_sheary: 0,
    ddy_shearx: 0,
    correction_vx: 0,
    correction_vy: 0,
    U: 0,
    ddx_vxvy: 0,
    ddy_vxvy: 0,
    ddx_vy: 0,
    ddy_vx: 0,
    ddx_P: 0,
    ddy_P: 0,
    wall: {},
    P: 0,
    ddy_vy: 0,
    ddx_vx: 0
  }

  // construct
  if (data === null) {
    console.log('initializing field')

    // clone EMPTY for each cell
    const lq = JSON.parse(
      JSON.stringify(new Array(SIZE).fill(new Array(SIZE).fill(EMPTY)))
    )

    // set up coordinates based on index and walls
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++) {
        const cell = lq[x][y]
        cell.x = x
        cell.y = y

        cell.px = Math.floor(((x + 1) * WIDTH) / (SIZE + 1))
        cell.py = Math.floor(((y + 1) * WIDTH) / (SIZE + 1))

        if (x === 0) cell.wall.left = true
        if (x === SIZE - 1) cell.wall.right = true
        if (y === 0) cell.wall.up = true
        if (y === SIZE - 1) cell.wall.down = true

        // add neighbors refs and add empty wall cells
        cell.left = !cell.wall.left ? lq[x - 1][y] : { ...EMPTY }
        cell.right = !cell.wall.right ? lq[x + 1][y] : { ...EMPTY }
        cell.up = !cell.wall.up ? lq[x][y - 1] : { ...EMPTY }
        cell.down = !cell.wall.down ? lq[x][y + 1] : { ...EMPTY }
      }
    }

    // fill in missing references for unrendered walls
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++) {
        const cell = lq[x][y]

        if (!cell.left.up) cell.left.up = cell.up.left || { ...EMPTY }
        if (!cell.left.down) cell.left.down = cell.down.left || { ...EMPTY }
        if (!cell.right.up) cell.right.up = cell.up.right || { ...EMPTY }
        if (!cell.right.down) cell.right.down = cell.down.right || { ...EMPTY }
        if (!cell.up.left) cell.up.left = cell.left.up || { ...EMPTY }
        if (!cell.up.right) cell.up.right = cell.right.up || { ...EMPTY }
        if (!cell.down.left) cell.down.left = cell.left.down || { ...EMPTY }
        if (!cell.down.right) cell.down.right = cell.right.down || { ...EMPTY }
      }
    }

    // return state with data this time
    return st({
      t: 0,
      lq,
      Pmax: -100,
      Pmin: 100
    })
  }

  // parse all cells helper
  const parseCells = (callBack, simple = false) => {
    if (simple || Math.random() < 0.5) {
      for (let x = 0; x < SIZE; x++) {
        for (let y = 0; y < SIZE; y++) {
          const cell = data.lq[x][y]
          callBack(cell, x, y)
        }
      }
    } else {
      for (let x = SIZE - 1; x >= 0; x--) {
        for (let y = SIZE - 1; y >= 0; y--) {
          const cell = data.lq[x][y]
          callBack(cell, x, y)
        }
      }
    }
  }

  // help keep values below 1 to converge and relax values
  let vLength,
    RELAX2 = RELAX ** 2
  const limiter = (vx, vy) => {
    vLength = Math.sqrt(vx ** 2 + vy ** 2)
    if (vLength < RELAX) return [vx * RELAX, vy * RELAX, vLength * RELAX]
    return [(vx * RELAX2) / vLength, (vy * RELAX2) / vLength, RELAX2]
  }

  // calculate flow field after time step
  const stepTime = () => {
    // random noise in all directions but consistent across field
    const xNoise = (Math.random() - 0.5) * RANDOM_NOISE
    const yNoise = (Math.random() - 0.5) * RANDOM_NOISE

    // helpers to calc properties -----------

    // limit and relax values & forces to prevent blow up
    const relaxVars = () => {
      parseCells((cell, x, y) => {
        ;[cell.vx, cell.vy, cell.U] = limiter(cell.vx, cell.vy)
        ;[cell.dpdx, cell.dpdy] = limiter(cell.dpdx, cell.dpdy)
        ;[cell.ddx_vy, cell.ddy_vx] = limiter(cell.ddx_vy, cell.ddy_vx)
        ;[cell.ddx_P, cell.ddy_P] = limiter(cell.ddx_P, cell.ddy_P)
        ;[cell.Hx, cell.Hy] = limiter(cell.Hx, cell.Hy)
        ;[cell.shearx, cell.sheary] = limiter(cell.shearx, cell.sheary)
        ;[cell.ddy_shearx, cell.ddx_sheary] = limiter(
          cell.ddy_shearx,
          cell.ddx_sheary
        )
      })
    }

    // take derivatives of cell properties: d/dx for dxProp and d/dy for dyProp
    let valx = 0,
      valy = 0,
      l,
      r,
      u,
      d
    const calc_ddxi = (cell, dxProp, dyProp = dxProp) => {
      // multiply props if multiple terms multiplied in prop
      valx = dxProp.split('*').reduce((res, prop) => res * cell[prop], 1)
      valy = dyProp.split('*').reduce((res, prop) => res * cell[prop], 1)

      l =
        valx - dxProp.split('*').reduce((res, prop) => res * cell.left[prop], 1)
      r =
        dxProp.split('*').reduce((res, prop) => res * cell.right[prop], 1) -
        valx

      u = valy - dyProp.split('*').reduce((res, prop) => res * cell.up[prop], 1)
      d =
        dyProp.split('*').reduce((res, prop) => res * cell.down[prop], 1) - valy

      // assign name based on prop and ddxi direction, remove * from name if any
      // 80% of value change at a time
      cell['ddx_' + dxProp.replace('*', '')] *= 0.5
      cell['ddx_' + dxProp.replace('*', '')] += (0.5 * (l + r)) / 2

      cell['ddy_' + dyProp.replace('*', '')] *= 0.5
      cell['ddy_' + dyProp.replace('*', '')] += (0.5 * (u + d)) / 2
    }

    // vx -> dpdx
    const calcPressureDrop = cell => {
      // grab pressure drop from integral on close sides but
      // averaging other neighbors to reduce fluctuations
      const MAIN = 0.22 // 0.3 // 0.22;
      // const SIDES = 0.1 // 0.1
      const CORNER = 0.14 // 0.05 // 0.14;

      // average with last pressure value
      cell.dpdx +=
        xNoise +
        MAIN * (cell.left.dpdx + cell.Hx - cell.left.Hx) +
        MAIN * (cell.right.dpdx + cell.Hx - cell.right.Hx) +
        CORNER * (cell.left.up.dpdx + cell.Hx - cell.left.up.Hx) +
        CORNER * (cell.left.down.dpdx + cell.Hx - cell.left.down.Hx) +
        CORNER * (cell.right.up.dpdx + cell.Hx - cell.right.up.Hx) +
        CORNER * (cell.right.down.dpdx + cell.Hx - cell.right.down.Hx)
      // SIDES * (cell.down.dpdx + cell.Hx - cell.down.Hx) +
      // SIDES * (cell.up.dpdx + cell.Hx - cell.up.Hx)
      cell.dpdx *= 0.5

      cell.dpdy +=
        yNoise +
        MAIN * (cell.up.dpdy + cell.Hy - cell.up.Hy) +
        MAIN * (cell.down.dpdy + cell.Hy - cell.down.Hy) +
        CORNER * (cell.up.right.dpdy + cell.Hy - cell.up.right.Hy) +
        CORNER * (cell.up.left.dpdy + cell.Hy - cell.up.left.Hy) +
        CORNER * (cell.down.right.dpdy + cell.Hy - cell.down.right.Hy) +
        CORNER * (cell.down.left.dpdy + cell.Hy - cell.down.left.Hy)
      // SIDES * (cell.right.dpdy + cell.Hy - cell.right.Hy) +
      // SIDES * (cell.left.dpdy + cell.Hy - cell.left.Hy)
      cell.dpdy *= 0.5
    }

    // dpdx -> P, kept stable w/ dpdx via ddx_P calculated from P
    const calcPressure = cell => {
      const L = cell.left.P + (cell.dpdx + cell.left.dpdx) / 2
      const R = cell.right.P - (cell.dpdx + cell.right.dpdx) / 2
      const U = cell.up.P + (cell.dpdy + cell.up.dpdy) / 2
      const D = cell.down.P - (cell.dpdy + cell.down.dpdy) / 2

      const L2 = cell.left.P + (cell.ddx_P + cell.left.ddx_P) / 2
      const R2 = cell.right.P - (cell.ddx_P + cell.right.ddx_P) / 2
      const U2 = cell.up.P + (cell.ddy_P + cell.up.ddy_P) / 2
      const D2 = cell.down.P - (cell.ddy_P + cell.down.ddy_P) / 2

      cell.P =
        0.1 * cell.P +
        (0.4 * (L + R + D + U)) / 4 +
        (0.5 * (L2 + R2 + D2 + U2)) / 4

      // update min and max pressure so can get 0-1 normalized pressure
      if (cell.P > data.Pmax) data.Pmax = cell.P
      if (cell.P < data.Pmin) data.Pmin = cell.P
    }

    const pressureBuildup = cell => {
      const ddt_vxvy =
        cell.correction_vy * cell.vx + cell.correction_vx * cell.vy
      const ddt_vxvy_left =
        cell.left.correction_vy * cell.left.vx +
        cell.left.correction_vx * cell.left.vy

      const dpdt =
        -1 *
        DENSITY *
        (cell.left.vx ** 2 * cell.left.ddx_vx +
          -1 * cell.right.vx ** 2 * cell.right.ddx_vx +
          cell.up.vy ** 2 * cell.up.ddy_vy +
          -1 * cell.down.vy ** 2 * cell.down.ddy_vy)

      cell.P = cell.P + DELTA_T * dpdt * TERNARY_CORRECTION
    }

    // end of helpers --------------

    // repeated calculation start (if RECALC_TIMES > 1)
    for (let i = 0; i < RECALC_TIMES; i++) {
      parseCells((cell, x, y) => {
        if (WALLS_ON) accountForWalls(cell)
        // for shear
        calc_ddxi(cell, 'vy', 'vx') // ddx_vy and ddy_vx
        ;[cell.ddy_vx, cell.ddx_vy] = limiter(cell.ddy_vx, cell.ddx_vy)

        // get shear forces from viscocity
        cell.shearx = VISCOCITY * (cell.ddy_vx + cell.ddx_vy)
        cell.sheary = VISCOCITY * (cell.ddx_vy + cell.ddy_vx)
        ;[cell.shearx, cell.sheary] = limiter(cell.shearx, cell.sheary)
      })

      parseCells((cell, x, y) => {
        if (WALLS_ON) accountForWalls(cell)

        // shear change
        calc_ddxi(cell, 'sheary', 'shearx')
        ;[cell.ddy_shearx, cell.ddx_sheary] = limiter(
          cell.ddy_shearx,
          cell.ddx_sheary
        )

        // get ddx_vxvy & ddy_vxvy
        calc_ddxi(cell, 'vx*vy')
        ;[cell.ddy_vxvy, cell.ddx_vxvy] = limiter(cell.ddy_vxvy, cell.ddx_vxvy)

        // sum up normal forces
        cell.Hx = -1 * DENSITY * cell.ddy_vxvy + cell.ddy_shearx
        cell.Hy = -1 * DENSITY * cell.ddx_vxvy + cell.ddx_sheary
        ;[cell.Hx, cell.Hy] = limiter(cell.Hx, cell.Hy)
      })

      parseCells((cell, x, y) => {
        if (WALLS_ON) accountForWalls(cell)
        // get pressure drop
        calcPressureDrop(cell) // dpdx dpdy
        ;[cell.dpdx, cell.dpdy] = limiter(cell.dpdx, cell.dpdy)
      })

      // testing correction based on absolute pressure
      // partial secondary t correction test
      parseCells((cell, x, y) => {
        if (WALLS_ON) accountForWalls(cell)
        calcPressure(cell) // for second correction
      })

      parseCells((cell, x, y) => {
        if (WALLS_ON) accountForWalls(cell)

        calc_ddxi(cell, 'P') // should give ddx_P and ddy_P
        calc_ddxi(cell, 'vx', 'vy') // ddx_vx ddy_vy
        // ;[cell.ddx_vx, cell.ddy_vy] = limiter(cell.ddx_vx, cell.ddy_vy)
        // ;[cell.ddx_P, cell.ddy_P] = limiter(cell.ddx_P, cell.ddy_P)
      })
    }
    // recalculation section end

    relaxVars()

    // primary correction from pressure gradient from last velocity set
    parseCells((cell, x, y) => {
      if (WALLS_ON) accountForWalls(cell)

      // this is change in velocity at new time step
      cell.correction_vx =
        (DELTA_T / DENSITY) *
        (cell.Hx - cell.dpdx + FORCE_X) *
        PRIMARY_CORRECTION
      cell.correction_vy =
        (DELTA_T / DENSITY) *
        (cell.Hy - cell.dpdy + FORCE_Y) *
        PRIMARY_CORRECTION

      // get new velocities with time step change
      cell.vx += cell.correction_vx
      cell.vy += cell.correction_vy
    })

    // secondary correction to adjust flowrate from absolute pressure
    parseCells((cell, x, y) => {
      if (WALLS_ON) accountForWalls(cell)

      cell.vx +=
        (DELTA_T / DENSITY) * (cell.Hx - cell.ddx_P) * SECONDARY_CORRECTION
      cell.vy +=
        (DELTA_T / DENSITY) * (cell.Hy - cell.ddy_P) * SECONDARY_CORRECTION
    })

    relaxVars()

    // secondary correction correcting for build up
    if (PRESSURE_BUILDUP)
      parseCells((cell, x, y) => {
        if (WALLS_ON) accountForWalls(cell)
        pressureBuildup(cell)
        ;[cell.ddx_P, cell.ddy_P] = limiter(cell.ddx_P, cell.ddy_P)
      })

    // mouse effects and random forced values
    parseCells((cell, x, y) => {
      if (WALLS_ON) accountForWalls(cell)

      // mouse changes local pressure drop based on movement direction
      if (
        USE_MOUSE &&
        (cell.px - mouse.x) * (cell.px - mouse.x) +
          (cell.py - mouse.y) * (cell.py - mouse.y) <
          MOUSE_RADIUS * MOUSE_RADIUS
      ) {
        // average with new direction the pressure drop to reduce flickering
        cell.dpdx =
          0.85 * cell.dpdx +
          ((0.15 * -1 * DENSITY) / DELTA_T) * 0.5 * Math.cos(mouse.angle) +
          (cell.wall ? 0 : (Math.random() - 0.5) * 0.1)
        cell.dpdy =
          0.85 * cell.dpdy +
          ((0.15 * -1 * DENSITY) / DELTA_T) * 0.5 * Math.sin(mouse.angle) +
          (cell.wall ? 0 : (Math.random() - 0.5) * 0.1)
      }

      // custom cells
      if (CUSTOM_FIELD) {
        if (x >= 19 && x <= 21 && y >= 19 && y <= 21) {
          cell.dpdx = CUSTOM_FIELD_X
          cell.dpdy = CUSTOM_FIELD_Y
        }
      }

      // console log clicked on cell
      if (
        mouse.clicked &&
        (cell.px - mouse.x) * (cell.px - mouse.x) +
          (cell.py - mouse.y) * (cell.py - mouse.y) <
          10 * 10
      ) {
        mouse.clicked = false
        console.log('clicked cell:', x, y, cell)
      }
    })

    return st(data)
  }

  // draws on canvas
  const drawField = () => {
    clean() // remove last frame art

    parseCells((cell, x, y) => {
      const px = cell.px
      const py = cell.py

      const normP = (cell.P - data.Pmin + 0.05) / (data.Pmax - data.Pmin + 0.3)

      SHOW_PRESSURE &&
        rect(
          px,
          py,
          SQUARE_SIZE,
          SQUARE_SIZE,
          `hsla(${(540 - 340 * normP).toFixed(2)},50%,50%,${(
            normP * 0.5
          ).toFixed(1)})`
        )

      SHOW_FLOW &&
        line(
          px,
          py,
          px + cell.vx * VECTOR_LENGTH,
          py + cell.vy * VECTOR_LENGTH,
          `hsla(${540 - 340 * cell.U}, 50%, 45%, ${(cell.U * 0.6 + 0.2).toFixed(
            3
          )})`
        )

      if (PRESSURE_BUILDUP && SHOW_PRESSURE && Math.random() < 0.0001)
        console.log(
          'Pmin',
          data.Pmin.toFixed(2),
          'P',
          cell.P.toFixed(2),
          'Pmax',
          data.Pmax.toFixed(2),
          'Pnorm',
          normP.toFixed(2)
        )
    }, true)

    // allow pmin and pmax to contract over time so
    // normalized pressure range is 0-1
    data.Pmin = 0.001 * 100 + 0.999 * data.Pmin
    data.Pmax = 0.001 * -100 + 0.999 * data.Pmax

    return st(data)
  }

  // starting vectors if needed
  const presets = (rnd = 0) => {
    console.log('set preset values')
    parseCells((cell, x, y) => {
      // assign random velocity
      cell.vx =
        Math.random() < rnd ? ((Math.random() - 0.2) * (SIZE - x)) / SIZE : 0
      cell.vy =
        Math.random() < rnd ? ((Math.random() - 0.2) * (SIZE - y)) / SIZE : 0
      cell.dpdx = ((-1 * DENSITY) / DELTA_T) * cell.vx * 0.5
      cell.dpdy = ((-1 * DENSITY) / DELTA_T) * cell.vy * 0.5
    })

    return st(data)
  }

  // helper to account for walls, in middle of cells to left of index 0 & so on
  const accountForWalls = cell => {
    if (cell.wall !== {}) {
      Object.keys(cell.wall).forEach(direction => {
        if (cell.wall.left || cell.wall.right) {
          cell[direction].dpdx = -cell.dpdx
          cell[direction].Hx = -cell.Hx
          cell[direction].ddx_P = -cell.ddx_P

          cell[direction].P = Math.max(cell.P, cell.up.P, cell.down.P) * 0.999
        }

        if (cell.wall.up || cell.wall.down) {
          cell[direction].dpdy = -cell.dpdy
          cell[direction].Hy = -cell.Hy
          cell[direction].ddy_P = -cell.ddy_P

          cell[direction].P =
            Math.max(cell.P, cell.left.P, cell.right.P) * 0.999
        }
      })

      // limit flow into wall, 0.2 instead of 0 purely for aesthetics
      if (cell.wall.left) cell.vx = Math.max(-0.2, cell.vx)
      if (cell.wall.up) cell.vy = Math.max(-0.2, cell.vy)
      if (cell.wall.right) cell.vx = Math.min(0.2, cell.vx)
      if (cell.wall.down) cell.vy = Math.min(0.2, cell.vy)
    }
  }

  // accessible methods
  return {
    stepTime,
    drawField,
    presets
  }
}

let lastFrame = Date.now()

// animation loop
const animate = async (
  state = st().presets(RANDOMNESS_INITIAL),
  nowTime = Date.now()
) => {
  // check framerate
  if (nowTime - lastFrame > 1000 / MAX_FRAME_RATE) {
    // draw last field and calculate new field
    state = state.drawField().stepTime()

    // update timestamp
    lastFrame = nowTime
  }

  // call itself at next animation frame
  window.requestAnimationFrame(() => animate(state))
}

// canvas to draw field
const canvas = document.getElementById('myCanvas')
const ctx = canvas.getContext('2d')
canvas.width = WIDTH
canvas.height = WIDTH

// helper to draw line on canvas
const line = (x1, y1, x2, y2, clr, r = VECTOR_LINE_WIDTH) => {
  ctx.beginPath()
  ctx.moveTo(x1 | 0, y1 | 0)
  ctx.lineTo(x2, y2)
  ctx.strokeStyle = clr
  ctx.lineWidth = r
  ctx.lineCap = 'square'
  ctx.stroke()
}

const rect = (x1, y1, cw, ch, clr) => {
  ctx.fillStyle = clr
  ctx.fillRect((x1 - cw) << 0, (y1 - ch) << 0, (cw * 2) << 0, (ch * 2) << 0)
}

// helper to remove past drawings
const clean = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

// grab mouse position in canvas coods
window.addEventListener('mousemove', e => {
  // 1 pixel movements a bit too jumpy
  mouse.oldx2 = (mouse.oldx + mouse.oldx2) / 2
  mouse.oldy2 = (mouse.oldy + mouse.oldy2) / 2
  mouse.oldx = mouse.x
  mouse.oldy = mouse.y

  const bounds = canvas.getBoundingClientRect()
  // mouse.x = e.offsetX - bounds.left - window.scrollX;
  // mouse.y = e.offsetY - bounds.top - window.scrollY;
  mouse.x = e.pageX - bounds.left - window.scrollX
  mouse.y = e.pageY - bounds.top - window.scrollY

  mouse.x = (mouse.x / bounds.width) * canvas.width
  mouse.y = (mouse.y / bounds.height) * canvas.height

  // a little motion damping to reduce flicker
  // mouse.angle = Math.atan2(
  //   mouse.y - (mouse.oldy2 + mouse.oldy) / 2,
  //   mouse.x - (mouse.oldx2 + mouse.oldx) / 2
  // )
  mouse.angle = Math.atan2(mouse.y - mouse.oldy2, mouse.x - mouse.oldx2)

  // move mouse coods far away when not on canvas
  if (
    mouse.x < 0 ||
    mouse.y < 0 ||
    mouse.x > canvas.width ||
    mouse.y > canvas.height
  ) {
    mouse.x = -2 * MOUSE_RADIUS
    mouse.y = -2 * MOUSE_RADIUS
    mouse.oldx = -2 * MOUSE_RADIUS
    mouse.oldy = -2 * MOUSE_RADIUS
    mouse.oldx2 = -2 * MOUSE_RADIUS
    mouse.oldy2 = -2 * MOUSE_RADIUS
  }
})

// for debugging
window.addEventListener('click', e => {
  mouse.clicked = true
})

// run program loop
animate()

