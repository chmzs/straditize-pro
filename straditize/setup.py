import os
import os.path as osp
from setuptools import find_packages, setup


def readme():
    with open('README.rst', encoding='utf-8') as f:
        return f.read()


with open(osp.join('straditize', 'version.py'), encoding='utf-8') as f:
    exec(f.read())


dependencies = [
    'numpy>=1.26,<3.0',
    'pandas>=2.3,<3.0',
    'matplotlib>=3.8,<3.11',
    'xarray>=2024.7,<2025',
    'psyplot-gui>=1.5.0,<2.0',
    'psyplot>=1.5.1,<2.0',
    'psy-strat>=0.1.1,<0.2',
    'scipy>=1.13,<1.14',
    'scikit-image>=0.23,<1.0',
    'pillow>=10,<12',
    'openpyxl>=3.1,<4.0',
    'netCDF4>=1.6.1,<2.0',
]

# During a conda build, the recipe supplies the Qt dependencies. For a
# PyPI wheel, always declare them even when the build environment already has
# PyQt5 installed; otherwise the wheel metadata silently omits the GUI stack.
if not os.getenv('CONDA_BUILD'):
    dependencies.extend([
        'PyQt5!=5.12',
        'PyQtWebEngine',
        'PyQt5-sip',
    ])


setup(
    name='straditize',
    version=__version__,
    description='Python package for digitizing pollen diagrams',
    long_description=readme(),
    classifiers=[
        'Development Status :: 4 - Beta',
        'Intended Audience :: Science/Research',
        'Topic :: Scientific/Engineering :: Visualization',
        'Topic :: Scientific/Engineering :: GIS',
        'Topic :: Scientific/Engineering',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.12',
        'Operating System :: OS Independent',
    ],
    keywords=('visualization earth-sciences paleo climate paleoclimate '
              'pollen diagram digitization database'),
    url='https://github.com/Chilipp/straditize',
    author='Philipp Sommer',
    author_email='philipp.sommer@unil.ch',
    license='GPL-3.0-or-later',
    python_requires='>=3.12,<3.13',
    packages=find_packages(exclude=['docs', 'tests*', 'examples']),
    install_requires=dependencies,
    package_data={'straditize': [
        osp.join('straditize', 'widgets', 'icons', '*.png'),
        osp.join('straditize', 'widgets', 'docs', '*.rst'),
        osp.join('straditize', 'widgets', 'docs', '*.png'),
        osp.join('straditize', 'widgets', 'tutorial', '*', '*.rst'),
        osp.join('straditize', 'widgets', 'tutorial', '*', '*.png'),
    ]},
    include_package_data=True,
    entry_points={
        'console_scripts': ['straditize=straditize.__main__:main'],
        'psyplot_gui': ['straditizer=straditize.widgets:StraditizerWidgets'],
    },
    zip_safe=False,
)
