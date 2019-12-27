// actions on push on chub
const fs = require('fs');
const Octokit = require("@octokit/rest");
const axios = require("axios");
const shell = require("shelljs");
const crypto = require('crypto');

async function encryptAndPutAuthFile(username, repo, algorithm, gitToken, authPhrase, _silent) {
    try {
        var cipher = crypto.createCipher(algorithm, gitToken);
        var encryptedPhrase = cipher.update(authPhrase, 'utf8', 'hex');
        encryptedPhrase += cipher.final('hex');
        shell.exec(`git checkout master`, {silent: _silent});
        shell.exec(`echo ${encryptedPhrase} > auth`, {silent: _silent});
        shell.exec(`git add auth`, {silent: _silent});
        shell.exec(`git commit -m 'add auth file'`, {silent: _silent});
        shell.exec(`git push https://${username}:${gitToken}@github.com/${repo} master`, {silent: _silent});
        return true
    } catch (err) {
        throw err
    }
}

async function getUserTokenAndDecrypt(repo, algorithm, pwd) {
    try {
        let resp = await axios.get(`https://api.github.com/repos/${repo}/contents/auth`);
        let content = Buffer.from(resp.data.content, 'base64').toString('ascii').replace(/\n/g, "");
        var decipher = crypto.createDecipher(algorithm, pwd);
        var token = decipher.update(content, 'hex', 'utf8');
        token += decipher.final('utf8');
        return token;
    } catch (err) {
        throw err
    }
}

async function fetchStartLesson(qHub, token, qHubCube) {
    console.log("Getting first lesson name...");
    try {
        let octokit = new Octokit({
            auth: "token " + token
        });
        // get first lesson from qhub
        let resp = await octokit.repos.getContents({
            owner: qHub,
            repo: qHubCube,
            path: `lessons.index`, // `cube.json`
            headers: {
                'accept': 'application/vnd.github.VERSION.raw'
            }
        });
        return {
            result: true,
            lessons: resp.data
        }
        // return {
        //     result: true,
        //     lesson: resp.data.split("\n").filter(Boolean)[0] // JSON.parse(resp.data)['index'][0]
        // }
    } catch (err) {
        return {
            result: false,
            error: "Couldn't get first lesson: " + err.message
        }
    }
}

async function pullFirstLesson(lessonsIndex, username, cube, token, cHub, qHub, qHubCube) {
    try {
        let initLessonBranch = lessonsIndex.split("\n").filter(Boolean)[0];
        console.log(`Fetching the first lesson '${initLessonBranch}'...`);

        const cloneUrl = `https://github.com/${cHub}/${username}-${cube}-cube`;
        const _silent = true;

        shell.exec(`git clone ${cloneUrl}`, { silent: _silent });
        process.chdir(process.cwd() +  `/${username}-${cube}-cube`);
        shell.exec(`git checkout --orphan ${initLessonBranch}`, { silent: _silent });
        shell.exec(`git rm -rf .`, { silent: _silent });
        shell.exec(`git pull https://${qHub}:${token}@github.com/${qHub}/${qHubCube}.git ${initLessonBranch}`, { silent: _silent });
        let cubeInfo = {};
        cubeInfo.current = { lesson: initLessonBranch };
        cubeInfo.lessons = {}
        lessonsIndex.split("\n").filter(Boolean).forEach(l => {
            cubeInfo.lessons[l] = {
                test: {
                    status: "pending"
                }
            }
        })
        shell.exec(`git checkout master`, { silent: _silent });
        fs.writeFileSync(`${cube}.cube.json`, JSON.stringify(cubeInfo));
        
        // add lesson.index
        fs.writeFileSync(`lessons.index`, lessonsIndex);
        
        shell.exec(`git add --all`, { silent: _silent });
        shell.exec(`git commit -m 'Add first lesson branch'`, { silent: _silent });
        shell.exec(`git push https://${cHub}:${token}@github.com/${cHub}/${username}-${cube}-cube.git --all`, { silent: _silent });
        
        return {
            result: true
        }

    } catch (err) {
        return {
            result: false,
            error: "Couldn't pull First Lesson to cHub: " + err.message
        }
    }
}

async function forkChubCube(username, cube, cHub, teacher, token) {
    console.log("Forking to student repo...");
    try {
        let octokit = new Octokit({
            auth: "token " + token
        });
        await octokit.repos.createFork({
            owner: cHub,
            repo: `${username}-${cube}-cube`
        });
        // add collaborator
        let cRes = await octokit.repos.addCollaborator({
            owner: username,
            repo: `${username}-${cube}-cube`,
            username: teacher
        })
        // accept invitation
        await axios.post(
            'https://webhooks.mongodb-stitch.com/api/client/v2.0/app/kportal-grmuv/service/kportalWeb/incoming_webhook/acceptGitInvitation?secret=secret', {
            "invitation_id": cRes.data.id,
            "username": teacher
        });
        
        return {
            result: true,
            repoLink: `https://github.com/${username}/${username}-${cube}-cube`
        }
    } catch (err) {
        console.log(err)
        return {
            result: false,
            error: "Couldn't Fork repo: " + err.message
        }
    }
}

async function enableStudentPage(username, cube, token) {
    console.log("Enable git page for student repo...");
    try {
        let octokit = new Octokit({
            auth: "token " + token
        });
        
        // enable page
        await octokit.repos.enablePagesSite({
            owner: username,
            repo: `${username}-${cube}-cube`,
            source: {
                "branch": "master",
                "path": "/docs"
            },
            headers: {
                accept: "application/vnd.github.switcheroo-preview+json"
            }
        })

        console.log("Done.");
        return {
            result: true,
            repoLink: `https://github.com/${username}/${username}-${cube}-cube`
        }
    } catch (err) {
        console.log(err)
        return {
            result: false,
            error: "Couldn't enable page: " + err.message
        }
    }
}

async function addActions(branch, username, cube, masterToken, studentToken, cHub, qHub, qHubCube) {
    try {
        let octokit = new Octokit({
            auth: "token " + masterToken
        });
        let stdOctokit = new Octokit({
            auth: "token " + studentToken
        });

        let d = (await octokit.repos.getContents({
            owner: qHub,
            repo: qHubCube,
            path: "",
            ref: branch + "-actions"
        })).data;

        let cHubFiles = d.filter(f => !f.name.endsWith(".gitignore") && !f.name.startsWith("onPushLesson")).map(f => f.name);
        let studentFiles = d.filter(f => !f.name.endsWith(".gitignore") && f.name.startsWith("onPushLesson")).map(f => f.name);

        for (let idx = 0; idx < cHubFiles.length; idx++) {
            const _file = cHubFiles[idx];
            console.log(_file);
            let d = (await octokit.repos.getContents({
                owner: qHub,
                repo: qHubCube,
                path: _file,
                ref: branch + "-actions"
            })).data;
            await octokit.repos.createOrUpdateFile({
                owner: cHub,
                repo: `${username}-${cube}-cube`,
                path: ".github/workflows/" + _file,
                message: "initial commit",
                content: d.content,
                branch: branch
            })
        }

        // student repo actions
        for (let idx = 0; idx < studentFiles.length; idx++) {
            const _file = studentFiles[idx];
            console.log(_file);
            let d = (await octokit.repos.getContents({
                owner: qHub,
                repo: qHubCube,
                path: _file,
                ref: branch + "-actions"
            })).data;
            await stdOctokit.repos.createOrUpdateFile({
                owner: username,
                repo: `${username}-${cube}-cube`,
                path: ".github/workflows/" + _file,
                message: "initial commit",
                content: d.content,
                branch: branch
            })
        }
        
        console.log("Done.");

    } catch (err) {
        console.log(err)
    }

}

async function deleteFile(owner, repo, path, message, branch, token) {
    try {
        let octokit = new Octokit({
            auth: "token " + token
        });
        let sha = (await octokit.repos.getContents({
            owner,
            repo,
            path,
            ref
        })).data.sha;
        if (sha) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path,
                message,
                sha,
                branch
            });
            return true;
        } else {
            throw new Error(" no sha found to remove auth file in master branch in " + repo + "repo!");
        }
    } catch (err) {
        throw err
    }
}

let initCube = async (username, cube, repo, gitToken) => {
    const algorithm = 'aes256';
    const authPhrase = 'unclecode';
    const server = "https://cubie.now.sh";
    const cHub = 'kportal-hub';
    const qHub = 'kportal-hub'; 
    const _silent = false;
    
    try {
        const qHubCube = `${cube}-qhub-test`; //`${cube}-qhub`
        const cHubCube = `${username}-${cube}-cube`; 
        
        // TODO
        const teacher = `nascoder`; 

        // create encrypted auth file and send it to server to get tokens
        await encryptAndPutAuthFile(cHub, repo, algorithm, gitToken, authPhrase, _silent);

        // get token from server
        let authRes = (await axios.post(server + "/api/check-auth", {
            username,
            gitToken,
            repo: cHubCube,
            path: `auth`,
            type: "c"
        })).data

        if (!authRes.result) {
            throw new Error("Unauthorized Access")
            // return false;
        } else {

            let r = await getUserTokenAndDecrypt(repo, algorithm, gitToken);
            const studentToken = r.split('\n')[0].split('=')[1]
            const masterToken = r.split('\n')[1].split('=')[1]

            // ========================================== func 1 - get lesson
            let res = await fetchStartLesson(qHub, masterToken, qHubCube);
            if(res.result){

                let initLessonBranch = res.lessons.split("\n").filter(Boolean)[0];

                // ========================================== func 2
                await pullFirstLesson(res.lessons, username, cube, masterToken, cHub, qHub, qHubCube);

                // ========================================== func 3 - fork cube repo
                await forkChubCube(username, cube, cHub, teacher, studentToken);
                
                // ========================================== func 4 - enable page
                let resp = await enableStudentPage(username, cube, studentToken);

                // ========================================== func 5 - add actions file for chub and student repo
                await addActions(initLessonBranch, username, cube, masterToken, studentToken, cHub, qHub, qHubCube);
                
                // ========================================== func 6 - delete auth file
                await deleteFile(
                    cHub, // owner
                    cHubCube, // repo
                    "auth", // path
                    "delete auth request file",
                    "master", // branch
                    masterToken
                );

                return resp;
            }
            return res
        }
        
    }
    catch(err){
        console.log(`Couldn't create and fetch lesson for ${cube}`, err )
        return false;
    }
}

const cubeOnPush = async (repo, gitToken) => {
    const cube = JSON.parse(fs.readFileSync(process.env.NODE_CUBE, 'utf8')).commits[0].message.split(".")[0];
    const userInfo = JSON.parse(fs.readFileSync(`${cube}.user.json`, 'utf8'))
    return await initCube(userInfo.username, cube, repo, gitToken)
}

cubeOnPush(process.argv[2], process.argv[3]).then((res) => {
    console.log(res)
})
