=================================
Digitizing stratigraphic diagrams
=================================

.. start-badges

.. list-table::
    :stub-columns: 1
    :widths: 10 90

    * - docs
      - |docs|
    * - package
      - |version| |joss| |github|
    * - implementations
      - |supported-versions| |supported-implementations|

.. |docs| image:: http://readthedocs.org/projects/straditize/badge/?version=latest
    :alt: Documentation Status
    :target: http://straditize.readthedocs.io/en/latest/?badge=latest

.. |version| image:: https://img.shields.io/pypi/v/straditize.svg?style=flat
    :alt: PyPI Package latest release
    :target: https://pypi.python.org/pypi/straditize

.. |supported-versions| image:: https://img.shields.io/pypi/pyversions/straditize.svg?style=flat
    :alt: Supported versions
    :target: https://pypi.python.org/pypi/straditize

.. |supported-implementations| image:: https://img.shields.io/pypi/implementation/straditize.svg?style=flat
    :alt: Supported implementations
    :target: https://pypi.python.org/pypi/straditize

.. |joss| image:: http://joss.theoj.org/papers/10.21105/joss.01216/status.svg
    :alt: Journal of Open Source Software
    :target: https://doi.org/10.21105/joss.01216

.. |github| image:: https://img.shields.io/github/release/Chilipp/straditize.svg
    :target: https://github.com/Chilipp/straditize/releases/latest
    :alt: Latest github release

.. end-badges

This refreshed ``0.2.2`` release focuses on reliable digitization on modern
Python, pandas and matplotlib stacks while preserving the original
stratigraphic workflow.

STRADITIZE (Stratigraphic Diagram Digitizer) is an open-source program that
allows stratigraphic figures to be digitized in a single semi-automated
operation. It is designed to detect multiple plots of variables analyzed along
the same vertical axis, whether this is a sediment core or any similar
depth/time series.

Usually, in an age of digital data analysis, gaining access to data from the
pre-digital era, or any data that is only available as a figure on a page,
remains a problem and an under-utilized scientific resource.

This program tackles this problem by providing a python package to digitize
especially pollen diagrams, but also any other type of stratigraphic diagram.

Straditize is written in python and supports mixtures of many different diagram
types, such as bar plots, line plots, as well as shaded, stacked, and filled
area plots. The package provides an extensively documented graphical user
interface for a point-and-click handling of the semi-automatic process, but can
also be scripted or used from the command line. Other features of STRADITIZE
include text recognition to interpret the names of the different plotted
variables, the automatic and semi-automatic recognition of picture artifacts,
as well an automatic measurement finder to exactly reproduce the data that has
been used to create the diagram.

Highlights in 0.2.2
-------------------

* Maintained runtime compatibility for Python 3.12, pandas 2.3, matplotlib 3.10
  and the current psyplot / psyplot-gui stack.
* Improved result review by overlaying digitized output on the source image
  with exportable comparison data.
* Better stacked-area sample inference via consensus interpolation.
* Restored modern Excel / NetCDF export paths and several headless Qt fixes.
* Repaired manual feature removal, interactive full-data editing and Windows
  Qt startup behavior on the maintained desktop stack.

Installation
------------

For most users, install the published wheel into an isolated Python 3.12
environment with pip::

    python -m pip install straditize
    python -m straditize

The wheel is platform-independent and is about 3 MB compressed. The scientific
and Qt dependencies are installed separately and require substantially more
disk space than the straditize package itself.

For development, install straditize into its own isolated environment from a
source checkout so the tested dependency stack is explicit.

Recommended source install with ``pixi``::

    git clone https://github.com/Chilipp/straditize.git
    cd straditize
    pixi init
    pixi add python=3.12 pip
    pixi add --pypi "numpy>=1.26,<3.0" "pandas>=2.3,<3.0" "matplotlib>=3.8,<3.11" "scipy>=1.13,<1.14" "xarray>=2024.7,<2025" "netcdf4>=1.6.1,<2" "scikit-image>=0.23,<1.0" "openpyxl>=3.1,<4" "pillow>=10,<12"
    pixi add --pypi "psyplot>=1.5.1,<2.0" "psyplot-gui>=1.5.0,<2.0" "psy-strat>=0.1.1,<0.2" "pyqt5>=5.15.10,<6" "pyqtwebengine>=5.15.6,<6"
    pixi run python -m pip install -e .
    pixi run python -m straditize

To build a Windows one-folder bundle from the maintained Pixi environment::

    pixi run build-windows

The full prototype bundle is about 602 MB uncompressed and starts with
``straditize.exe -V``. A lean prototype, built with
``pixi run build-windows-lite``, removes the HTML-help and IPython/Jupyter
packages and is about 545 MB uncompressed. Both are suitable for testing, but
the lean bundle still needs GUI workflow testing before distribution.

Alternative source install with ``mamba``/``conda``::

    git clone https://github.com/Chilipp/straditize.git
    cd straditize
    mamba create -n straditize python=3.12 pip
    mamba activate straditize
    pip install "numpy>=1.26,<3.0" "pandas>=2.3,<3.0" "matplotlib>=3.8,<3.11" "scipy>=1.13,<1.14" "xarray>=2024.7,<2025" "netcdf4>=1.6.1,<2" "scikit-image>=0.23,<1.0" "openpyxl>=3.1,<4" "pillow>=10,<12" "psyplot>=1.5.1,<2.0" "psyplot-gui>=1.5.0,<2.0" "psy-strat>=0.1.1,<0.2" "PyQt5>=5.15.10,<6" "PyQtWebEngine>=5.15.6,<6"
    pip install -e .

It can then be started from the command line via::

    straditize

Validated dependency stack
--------------------------

The current development environment has been verified with:

* Python 3.12
* NumPy 2.2
* pandas 2.3
* matplotlib 3.10
* SciPy 1.13
* xarray 2024.11
* netCDF4 1.7
* psyplot 1.5.1
* psyplot-gui 1.5.0
* PyQt5 5.15

Other versions may work, but this is the supported and tested Pixi stack. In
particular, pandas 3.x is not currently supported because NetCDF project
serialization is not compatible with it.

A more detailed description is provided in the docs_.

.. _docs: https://straditize.readthedocs.io/en/latest/installing.html

License
-------
straditize is published under the
`GNU General Public License v3.0 <https://www.gnu.org/licenses/>`__
under the copyright of Philipp S. Sommer, 2018-2019
