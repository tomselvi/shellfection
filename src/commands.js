import "colors"
import fs from "fs"
import fse from "fs-extra"
import readline from "readline"
import * as _ from "lodash"
import svgToPng from "svg-to-png"
import userHome from "user-home"
const Gists = require("gists")
import { exec } from "child_process"

import * as util from "./util"

import defaultConfig from "../config.json"

let config = _.cloneDeep(defaultConfig)
let userConfig = {}

if (fs.existsSync(`${userHome}/.shellfection.json`)) {
  userConfig = JSON.parse(fs.readFileSync(`${userHome}/.shellfection.json`))

  config.casks = _.union(defaultConfig.casks, userConfig.casks)
  config.clones = _.unionBy(defaultConfig.clones, userConfig.clones, (o) => JSON.stringify(o))
  config.gist = userConfig.gist
  config.gists = _.union(defaultConfig.gists, userConfig.gists)
  config.packages = _.merge(defaultConfig.packages, userConfig.packages)
  config.pip = _.merge(defaultConfig.pip, userConfig.pip)
  config.npm = _.merge(defaultConfig.npm, userConfig.npm)
  config.symlinks = _.unionBy(defaultConfig.symlinks, userConfig.symlinks, (o) => JSON.stringify(o))
  config.themer = _.merge(defaultConfig.themer, userConfig.themer)
}

const { casks, clones, gist, gists, packages, pip, symlinks, themer, npm } = config

async function getGistsProvider (spinner, username, password) {
  return new Promise((resolve) => {
    spinner.stop(true)

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    })

    if (!username) {
      rl.question("GitHub username: ", (username) => {
        rl.question("GitHub password: ", (password) => {
          spinner.start()

          resolve(new Gists({
            username,
            password,
          }))
        })
      })
    }
    else {
      spinner.start()

      resolve(new Gists({
        username,
        password,
      }))
    }

  })
}

export function sync(spinner) {
  spinner.setSpinnerTitle("getting os type...".blue)
  spinner.setSpinnerString(11)
  spinner.start()

  return util.getOSType()
    .then((osType) => {
      spinner.setSpinnerTitle("getting casks and packages...".blue)

      return Promise.all([
        util.getCasks(osType),
        util.getPackages(osType),
      ])
    })
    .then(([casks, packages]) => {
      userConfig.casks = casks
      userConfig.packages = _.merge(packages, userConfig.packages)

      spinner.setSpinnerTitle("writing to ~/.shellfection.json...".blue)

      fs.writeFileSync(`${userHome}/.shellfection.json`, JSON.stringify(userConfig, false, "  "))

      spinner.stop(true)
    })
}

export async function gistDownload(spinner) {
  spinner.setSpinnerTitle("getting gist provider...".blue)
  spinner.setSpinnerString(11)
  spinner.start()

  const gistsProvider = await getGistsProvider(spinner)

  spinner.setSpinnerTitle("getting gist...".blue)

  return gistsProvider.get(gist)
    .then((res) => {
      spinner.setSpinnerTitle("updating local files...".blue)

      gists.forEach((fileName) => {
        const match = res.body.files[fileName]

        if (match) {
          fs.writeFileSync(`${userHome}/${fileName}`, match.content)
        }
      })

      spinner.stop(true)
    })
}

function getEmptyFiles(fileNames) {
  const files = {}

  fileNames.forEach((fileName) => files[fileName] = null)

  return files
}

function getFiles(fileNames) {
  const files = {}

  fileNames.forEach((fileName) => {
    const fileContents = fs.readFileSync(`${userHome}/${fileName}`)

    files[fileName] = {
      filename: fileName,
      size: fileContents.length,
      content: fileContents.toString(),
    }
  })

  return files
}

export async function gistUpload(spinner) {
  spinner.setSpinnerTitle("getting gist provider...".blue)
  spinner.setSpinnerString(11)
  spinner.start()

  const gistsProvider = await getGistsProvider(spinner)

  spinner.setSpinnerTitle("clearing gist...".blue)

  let options

  return gistsProvider.get(gist)
    .then((res) => {
      options = res.body
      const fileNames = Object.keys(res.body.files)
      if (!fileNames.length) {
        return Promise.resolve()
      }
      options.files = getEmptyFiles(fileNames)
      return gistsProvider.edit(gist, options)
    })
    .then(() => {
      spinner.setSpinnerTitle("updating gist...".blue)

      options.files = getFiles(gists)

      return gistsProvider.edit(gist, options)
    })
    .then(() => spinner.stop(true))
}

export const install = (options, spinner) => {
  spinner.setSpinnerTitle("detecting OS...".blue)
  spinner.setSpinnerString(11)
  spinner.start()

  return util.getOSType()
    .then((osType) => {
      spinner.stop(true)

      console.log(`detected ${Symbol.keyFor(osType).yellow}`.cyan)

      spinner.start()

      if (options.skipPackages) {
        return Promise.resolve([osType, []])
      }

      spinner.setSpinnerTitle("installing packages...".blue)

      return util.series(Object.keys(packages).map(pkgId => () => {
        const pkg = packages[pkgId]

        spinner.setSpinnerTitle(`installing ${pkgId}`.blue)

        return util.installPackage(osType, pkg)
          .then((installStatus) => {
            spinner.stop(true)

            if (installStatus === util.InstallStatus.Installed) {
              console.log(`${"installed".cyan} ${pkgId.green}`)
            }
            else if (installStatus === util.InstallStatus.Failed) {
              console.log(`${"failed to install".cyan} ${pkgId.red}`)
            }
            else if (installStatus === util.InstallStatus.NoChanges) {
              console.log(`${"no changes to".cyan} ${pkgId.yellow}`)
            }

            spinner.start()

            return installStatus
          })
      }))
        .then((results) => [osType, results])
    })
    .then(([osType, results]) => {
      const resultMap = _.countBy(
        results,
        (result) => Symbol.keyFor(result),
      )

      resultMap.Installed = resultMap.Installed || 0
      resultMap.Failed = resultMap.Failed || 0
      resultMap.NoChanges = resultMap.NoChanges || 0

      spinner.stop(true)

      console.log(`${"packages installed".cyan} ${resultMap.Installed.toString().green} ${"failed".cyan} ${resultMap.Failed.toString().red} ${"no changes".cyan} ${resultMap.NoChanges.toString().yellow}`)

      spinner.start()

      if (options.skipPackages) {
        return Promise.resolve([])
      }

      spinner.setSpinnerTitle("installing casks...".blue)

      return util.series(casks.map(cask => () => {
        spinner.setSpinnerTitle(`installing ${cask}`.blue)

        return util.installCask(osType, cask)
          .then((installStatus) => {
            spinner.stop(true)

            if (installStatus === util.InstallStatus.Installed) {
              console.log(`${"installed".cyan} ${cask.green}`)
            }
            else if (installStatus === util.InstallStatus.Failed) {
              console.log(`${"failed to install".cyan} ${cask.red}`)
            }
            else if (installStatus === util.InstallStatus.NoChanges) {
              console.log(`${"no changes to".cyan} ${cask.yellow}`)
            }

            spinner.start()

            return installStatus
          })
      }))
    })
    .then((results) => {
      const resultMap = _.countBy(
        results,
        (result) => Symbol.keyFor(result),
      )

      resultMap.Installed = resultMap.Installed || 0
      resultMap.Failed = resultMap.Failed || 0
      resultMap.NoChanges = resultMap.NoChanges || 0

      spinner.stop(true)

      console.log(`${"casks installed".cyan} ${resultMap.Installed.toString().green} ${"failed".cyan} ${resultMap.Failed.toString().red} ${"no changes".cyan} ${resultMap.NoChanges.toString().yellow}`)

      spinner.start()

      spinner.setSpinnerTitle("symlinking...".blue)

      symlinks.forEach(([from, to]) => {
        spinner.stop(true)

        const exists = fs.existsSync(`${userHome}/${to}`)
        const clean = options.clean || options.deepClean

        if (clean && exists) {
          fs.unlinkSync(`${userHome}/${to}`)
        }

        if (!clean && exists) {
          console.log(`${"already exists".cyan} ${to.yellow}`)
        }

        if (!exists || clean) {
          console.log(`${"symlinked".cyan} ${from.yellow} ${"to".cyan} ${to.yellow}`)

          fs.symlinkSync(`${__dirname}/../${from}`, `${userHome}/${to}`)
        }

        spinner.start()
      })

      spinner.setSpinnerTitle("cloning local configuration...".blue)

      clones.forEach(([from, to]) => {
        spinner.stop(true)

        const exists = fs.existsSync(`${userHome}/${to}`)

        if (options.deepClean && exists) {
          fse.removeSync(`${userHome}/${to}`)
        }

        if (!options.deepClean && exists) {
          console.log(`${"already exists".cyan} ${to.yellow}`)
        }

        if (!exists || options.deepClean) {
          console.log(`${"copied".cyan} ${from.yellow} ${"to".cyan} ${to.yellow}`)

          fse.copySync(`${__dirname}/../${from}`, `${userHome}/${to}`)
        }

        spinner.start()
      })

      spinner.stop()

      return installNpm(options, spinner)
    })
    .then(() => installThemer(options, spinner))
    .then(() => installPip(options, spinner))
    .catch(err => console.error(err))
}

export const installNpm = (options, spinner) => {
  spinner.start()
  spinner.setSpinnerTitle("installing npm packages...".blue)

  return util.series(Object.keys(npm).map(pkg => () => {
    const pkgWVersion = `${pkg}@${npm[pkg]}`

    spinner.setSpinnerTitle(`${"installing".blue} ${pkgWVersion.yellow}`)
    return util.installNpm(pkgWVersion)
      .then(() => {
        spinner.stop(true)

        console.log(`${"installed".cyan} ${pkgWVersion.yellow}`)

        spinner.start()
      })
  }))
    .then(() => {
      spinner.stop(true)
    })
}

export const installPip = (options, spinner) => {
  spinner.start()
  spinner.setSpinnerTitle("installing pip packages...".blue)

  return util.series(Object.keys(pip).filter(pkg => pip[pkg]).map(pkg => () => {
    const pkgWVersion = `${pkg}${pip[pkg].version ? `==${pip[pkg].version}` : ""}`

    spinner.setSpinnerTitle(`${"installing".blue} ${pkgWVersion.yellow}`)
    return util.installPip(pkgWVersion)
      .then(() => {
        spinner.stop(true)

        console.log(`${"installed".cyan} ${pkgWVersion.yellow}`)

        spinner.start()
      })
  }))
    .then(() => {
      spinner.stop(true)
    })
}

export const installThemer = (options, spinner) => {
  return new Promise((resolve, reject) => {
    spinner.start()
    spinner.setSpinnerTitle("building themer...".blue)

    const templates = themer.templates.map(t => `-t ${t}`).join(" ")

    exec(`themer -c ${themer.colorscheme} ${templates} -o ${__dirname}/../themer`, (err) => {
      if (err) {
        reject(err)
      }

      spinner.stop(true)

      console.log(`${"successfully built themer files in".cyan} ${"themer".yellow}`)

      spinner.start()

      spinner.setSpinnerTitle("symlinking theme files...".blue)

      themer.symlinks.forEach(([from, to]) => {
        spinner.stop(true)

        const exists = fs.existsSync(`${userHome}/${to}`)

        if (exists) {
          fs.unlinkSync(`${userHome}/${to}`)
        }

        console.log(`${"symlinked".cyan} ${from.yellow} ${"to".cyan} ${to.yellow}`)

        fs.symlinkSync(`${__dirname}/../${from}`, `${userHome}/${to}`)

        spinner.start()
      })

      spinner.setSpinnerTitle("converting wallpapers...".blue)

      const log = console.log

      console.log = () => {}

      Promise.all(themer.svgToPngDirectories.map(spdir => {
        const svgFiles = fs.readdirSync(`${__dirname}/../${spdir}`).filter(name => /\.svg$/.test(name))

        return Promise.all(svgFiles.map(svgFile =>
          svgToPng.convert(`${__dirname}/../${spdir}/${svgFile}`, `${__dirname}/../${spdir}`)
        ))
      }).reduce((a, b) => a.concat(b), []))
        .then((result) => {
          console.log = log

          spinner.stop(true)

          console.log(`${"successfully converted".cyan} ${result.length.toString().yellow} ${"directories of svgs to pngs".cyan}`)

          resolve()
        })
    })
  })
}
