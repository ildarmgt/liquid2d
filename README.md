# 2D Navier Stokes Liquid Simulation

Live demo: https://codepen.io/ildarmgt/full/ExPgooV

# Design

Mouse movement creates pressure drops

Made with visualization as priority

Single pass with 2 corrections

Liquid assumed incompressible

1. Pressure drops derived from previous velocities, corresponding shear stresses, and continuity
2. Next time step's velocities derived using those pressure drops
3. Absolute pressure estimated across the field and is averaged into both pressure and correction for next step's velocity
4. Pressure change over time estimated from simplified time partial derivative of P(v) expression and averaged in for pressure at next step

# Useful sources

Solution methods for the Incompressible Navier-Stokes Equations (typos here, i used instead of j sometimes)
https://web.stanford.edu/class/me469b/handouts/incompressible.pdf

https://rachelbhadra.github.io/smoke_simulator/index.html

Real-Time Fluid Dynamics for Games by Jos Stam

HOW TO SOLVE THE NAVIER-STOKES EQUATION - Benk Janos

https://ocw.mit.edu/courses/mechanical-engineering/2-29-numerical-fluid-mechanics-spring-2015/lecture-notes-and-references/MIT2_29S15_Lecture19.pdf

http://jamie-wong.com/2016/08/05/webgl-fluid-simulation/
