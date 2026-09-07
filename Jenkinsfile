// Jenkinsfile — hello-world-desktop-2
//
// Generated from ai-gang's setup/Jenkinsfile.template; keep the shared
// parts in sync with it and only fill in the project-specific commands.
//
// Implements the per-story flow from strategy/v1.0/features/release-workflow.md
// (REQ-01, REQ-10, REQ-11) as TWO builds of this one file. A single build
// can't do it all: the PR build IS the required status check that unlocks
// the merge, and GitHub only performs that merge after the build has posted
// its final status -- i.e. after the build has ended. So anything that must
// happen *after* the merge (promote to beta, deploy, evidence, In Review)
// has to live in the build the merge itself triggers:
//
//   1. PR build  (BRANCH_NAME = PR-N, CHANGE_ID set)
//      Install -> Test -> Build, then `gh pr merge --auto`. GitHub squash-
//      merges the PR into `dev` once this build reports success. Nothing
//      beta- or Jira-status-related happens here. The ticket stays In
//      Progress (REQ-10).
//
//   2. dev build (BRANCH_NAME = dev), triggered by the push that merge makes
//      Install -> Test -> Build again on the merged tip (the only build that
//      ever sees the real post-merge `dev`), then fast-forward `beta` to
//      exactly this commit, deploy it to the Beta VM, post the beta URL /
//      SHA / build identifier to every ticket whose PR landed since `beta`
//      was last promoted, and move each of those tickets to In Review.
//
// Ticket keys for the dev build come from GitHub's own commit -> pull-request
// association (the squash commit's merged PR, then its head branch and
// title), falling back to the commit subject. That covers agent merges,
// merges a human makes from the GitHub UI, and several PRs landing before
// one dev build gets an executor -- `origin/beta..dev` is the unit of work,
// so nothing is skipped or double-counted.
//
// On failure of either build, Jenkins posts attributable evidence to the
// affected ticket(s) and publishes a `pipeline_retry` message to ScrumMaster
// over the same jira-gateway Redis channel agents use (REQ-11). It never
// names an agent; ScrumMaster looks up the ticket's recorded owner.
//
// Release preview and production promotion are NOT handled here -- they're
// separate, centrally-defined Jenkins jobs (release-candidate,
// production-promote, release-preview-teardown; see jenkins/jenkins.yaml)
// triggered from a Jira Release ticket.
//
// GitHub prerequisites (setup/JenkinsConfig.md §7): "Allow auto-merge" on
// the repo; `dev` requires the status check `continuous-integration/jenkins/
// pr-merge` (the context a PR build posts) with "require branches to be up
// to date" OFF -- with it on, the second of two queued PRs can never
// auto-merge after the first lands, because nothing updates its branch.

pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    // One dev build at a time: two of them racing on the beta push / Jira
    // transitions would be the same problem this split exists to avoid.
    disableConcurrentBuilds()
  }

  environment {
    // Matches config/projects.json's `name` for jiraProjectKey HWD2 and the
    // live aigang:gateway:hello-world-desktop / aigang:agent:hello-world-desktop:*
    // Redis keys ScrumMaster already routes through -- NOT the GitHub repo's
    // own "hello-world-desktop-2" name.
    PROJECT_NAME = 'hello-world-desktop'

    // Bound through Jenkins credentials (jenkins/jenkins.yaml) rather than
    // read straight from the container's env so the console log masks it --
    // `sh` echoes every command it runs, including the `curl -u` below.
    // JIRA_URL / JIRA_EMAIL / GITHUB_TOKEN / REDIS_HOST still come from the
    // container env (jenkins/docker-compose.yml); `gh` picks GITHUB_TOKEN up
    // on its own and never prints it.
    JIRA_TOKEN = credentials('jira-token')
  }

  stages {
    stage('Resolve') {
      // Work out what this build is for BEFORE testing, so a failure
      // anywhere below can still be attributed to the right ticket(s).
      steps {
        script {
          if (env.CHANGE_ID) {
            env.PIPELINE_KIND = 'pr'
            // feature/GANG-42-password-reset -> GANG-42. CHANGE_BRANCH is the
            // real head branch; BRANCH_NAME is only the PR-N pseudo-branch.
            env.JIRA_TICKET = sh(returnStdout: true, script: '''
              printf %s "$CHANGE_BRANCH" | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1 || true
            ''').trim()
            echo "PR #${env.CHANGE_ID}: ${env.CHANGE_BRANCH} -> ${env.CHANGE_TARGET}, ticket ${env.JIRA_TICKET ?: '(none)'}"
          } else if (env.BRANCH_NAME == 'dev') {
            env.PIPELINE_KIND = 'dev'
            // Multibranch checkouts fetch only their own branch, so bring in
            // beta explicitly. Credentials are needed for private repos.
            withCredentials([gitUsernamePassword(credentialsId: 'github-token', gitToolName: 'Default')]) {
              sh 'git fetch origin +refs/heads/beta:refs/remotes/origin/beta'
            }
            // Promote exactly the commit this build tested, not whatever
            // `dev` points at by the time we get to pushing.
            env.PROMOTE_SHA = env.GIT_COMMIT
            env.BETA_SHA = sh(returnStdout: true, script: 'git rev-parse origin/beta').trim()
            // Every first-parent commit beta doesn't have yet -> its merged
            // PR (GitHub associates squash *and* merge commits with the PR
            // that produced them) -> ticket key from the PR's head branch,
            // else its title, else the commit subject. Deduplicated, space-
            // separated. Direct commits with no PR and no key are simply
            // promoted without a ticket.
            env.PROMOTE_TICKETS = sh(returnStdout: true, script: '''
              for sha in $(git rev-list --first-parent --reverse "origin/beta..$PROMOTE_SHA"); do
                key=$(
                  {
                    gh api "repos/{owner}/{repo}/commits/$sha/pulls" \
                      --jq '.[] | select(.merged_at != null and .base.ref == "dev") | .head.ref, .title' \
                      || echo "WARN: PR lookup failed for $sha, falling back to its commit subject" >&2
                    git log -1 --format=%s "$sha"
                  } | grep -oE '[A-Z][A-Z0-9]+-[0-9]+' | head -1 || true
                )
                if [ -n "$key" ]; then echo "$key"; fi
              done | awk '!seen[$0]++' | tr '\\n' ' '
            ''').trim()
            if (env.PROMOTE_SHA == env.BETA_SHA) {
              echo "beta is already at ${env.PROMOTE_SHA} -- nothing to promote"
            } else {
              echo "Promoting origin/beta..${env.PROMOTE_SHA} (tickets: ${env.PROMOTE_TICKETS ?: '(none)'})"
            }
          } else {
            // beta / prod / anything else: build-verify only.
            env.PIPELINE_KIND = 'other'
          }
        }
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Test') {
      steps {
        // No unit-test framework configured yet for this project (see
        // src/CLAUDE.md) -- the build gate below is what actually validates
        // changes today. Replace with a real test command once one exists.
        echo 'No test suite configured yet — build is the current gate.'
      }
    }

    stage('Build') {
      steps {
        sh 'npm run build'
      }
    }

    // ---- PR build only -------------------------------------------------

    stage('Queue merge to dev') {
      when {
        allOf {
          changeRequest target: 'dev'
          // Only ticket branches auto-merge. release/<sha> -> prod PRs (cut
          // by the release-candidate job) and anything else get tested here
          // but are never merged by this pipeline.
          expression { env.CHANGE_BRANCH ==~ /(feature|bugfix|chore)\/.*/ }
        }
      }
      steps {
        // Jenkins' own test gate is the only gate -- no Jira transition is
        // needed to reach this point.
        //
        // --auto, not a direct merge: this build's final commit status is
        // what dev's required check waits on, so merging synchronously here
        // is circular. --auto asks GitHub to merge the moment that status
        // lands; the push it makes to dev then triggers the dev build above.
        //
        // Jenkins checks PR builds out as a detached-HEAD merge commit, so
        // gh can't infer the PR from a branch -- pass CHANGE_ID explicitly.
        // Idempotent: a re-run of a build whose PR already has auto-merge
        // queued leaves it alone. Ask gh for a boolean: its --jq prints a JSON
        // null as an empty string, not the literal "null", so comparing the
        // raw autoMergeRequest object against "null" never matches and the
        // merge is silently skipped.
        //
        // The squash subject is pinned to "<PR title> (#N)" so the ticket
        // key the agent put in the PR title is always in dev's history --
        // the dev build's last-resort fallback for finding the ticket.
        sh '''
          AUTO_MERGE=$(gh pr view "$CHANGE_ID" --json autoMergeRequest --jq '.autoMergeRequest != null')
          if [ "$AUTO_MERGE" != "true" ]; then
            gh pr merge "$CHANGE_ID" --squash --auto --subject "$CHANGE_TITLE (#$CHANGE_ID)"
          else
            echo "auto-merge already queued for PR #$CHANGE_ID"
          fi
        '''
      }
    }

    // ---- dev build only ------------------------------------------------

    stage('Promote to beta and deploy') {
      when { expression { env.PIPELINE_KIND == 'dev' && env.PROMOTE_SHA != env.BETA_SHA } }
      steps {
        // Branches make batching free: this is a fast-forward of exactly
        // the tested commit, not a rebuild -- beta always mirrors dev. It's
        // rejected (and this build fails loudly) if beta has somehow
        // diverged, since beta requires linear history.
        //
        // A plain `git push` has no credentials -- the checkout step's
        // GIT_ASKPASS is scoped to that one operation. gitUsernamePassword
        // re-wires it for the push, and the log masks the token.
        withCredentials([gitUsernamePassword(credentialsId: 'github-token', gitToolName: 'Default')]) {
          sh 'git push origin "$PROMOTE_SHA:refs/heads/beta"'
        }

        // Interim: no Beta VM is provisioned for this project yet (BETA_VM_HOST /
        // PREVIEW_DOMAIN unset in ~/ai-gang/.env). Per docs/release-strategy.md's
        // "Container fallback on the Development VM", deploy this same build as a
        // container on the Development VM instead -- Dockerfile.beta builds the
        // production bundle and serves it on the same internal port (8080)
        // beta-vm/deploy/deploy.sh expects, so nothing about the image or the
        // build changes when this is swapped for a real Beta VM deploy later.
        sh '''
          SHORT_SHA=$(printf '%.7s' "$PROMOTE_SHA")
          docker build -f Dockerfile.beta -t "beta-hello-world-desktop-2:$SHORT_SHA" -t beta-hello-world-desktop-2:latest .
          docker rm -f beta-hello-world-desktop-2 >/dev/null 2>&1 || true
          docker run -d --name beta-hello-world-desktop-2 \
            --restart unless-stopped \
            -p 8082:8080 \
            --label "project=hello-world-desktop-2" \
            --label "sha=$SHORT_SHA" \
            "beta-hello-world-desktop-2:$SHORT_SHA"
        '''
        // Once a real Beta VM is provisioned, replace the block above with:
        //   sh "ssh beta-deploy@\$BETA_VM_HOST deploy ${env.PROJECT_NAME} ${env.PROMOTE_SHA}"

        script {
          env.DEPLOYED_SHA = env.PROMOTE_SHA
          env.BUILD_IDENTIFIER = "${env.PROJECT_NAME}-${env.PROMOTE_SHA.take(7)}-${env.BUILD_NUMBER}"
        }
      }
    }

    stage('Post evidence and move to In Review') {
      when { expression { env.PIPELINE_KIND == 'dev' && env.PROMOTE_SHA != env.BETA_SHA && env.PROMOTE_TICKETS } }
      steps {
        // Beta URL is normally <project>.<BETA_DOMAIN>, routed through Traefik
        // on the Beta VM (beta-vm/README.md). Interim: while beta runs as a
        // container on the Development VM instead (see the "Promote to beta
        // and deploy" stage above), point testers at that container's LAN URL
        // -- update this once a real Beta VM and BETA_DOMAIN exist.
        //
        // jira:3.21's jiraComment step reports "[Jira] Failed to connect to
        // Jira" from here even though Jira is reachable, and the plugin has
        // no transition step at all -- go through Jira's REST API directly,
        // the same way jira.js's postComment() and transitionIssue() do.
        //
        // Evidence first, then -- and only then -- In Review: this is the
        // single place a ticket leaves In Progress on the happy path
        // (REQ-10). A ticket with no In Review transition available (e.g.
        // already reviewed or Done) keeps its evidence and its status.
        sh '''
          for ticket in $PROMOTE_TICKETS; do
            COMMENT_TEXT=$(printf 'Deployed to beta.\\n\\nBeta URL: http://192.168.1.116:8082\\nSHA: %s\\nBuild: %s\\nBuild log: %s' \
                "$DEPLOYED_SHA" "$BUILD_IDENTIFIER" "$BUILD_URL")
            curl -sS --fail-with-body -u "$JIRA_EMAIL:$JIRA_TOKEN" -X POST \
                -H 'Content-Type: application/json' \
                -d "$(jq -n --arg text "$COMMENT_TEXT" '{body:{type:"doc",version:1,content:[{type:"paragraph",content:[{type:"text",text:$text}]}]}}')" \
                "$JIRA_URL/rest/api/3/issue/$ticket/comment" > /dev/null

            TRANSITION_ID=$(curl -sS --fail-with-body -u "$JIRA_EMAIL:$JIRA_TOKEN" \
                "$JIRA_URL/rest/api/3/issue/$ticket/transitions" \
              | jq -r '.transitions[] | select(.to.name=="In Review") | .id')
            if [ -z "$TRANSITION_ID" ]; then
              echo "WARN: $ticket has no In Review transition from its current status -- evidence posted, status left as-is" >&2
              continue
            fi
            curl -sS --fail-with-body -u "$JIRA_EMAIL:$JIRA_TOKEN" -X POST \
                -H 'Content-Type: application/json' \
                -d "$(jq -n --arg id "$TRANSITION_ID" '{transition:{id:$id}}')" \
                "$JIRA_URL/rest/api/3/issue/$ticket/transitions"
            echo "$ticket -> In Review"
          done
        '''
      }
    }
  }

  post {
    failure {
      script {
        // PR build: the one ticket this PR is for. dev build: every ticket
        // whose merge this build was supposed to promote (resolved up front,
        // so even a test failure on the merged tip is attributed). Other
        // builds (beta/prod verification) have nobody to tell.
        def tickets = (env.PIPELINE_KIND == 'pr' ? [env.JIRA_TICKET] : (env.PROMOTE_TICKETS ?: '').tokenize(' ')).findAll { it }
        if (tickets) {
          def what = "Pipeline failed on the post-merge dev build (beta promotion / deploy for ${env.PROMOTE_SHA})."
          if (env.PIPELINE_KIND == 'pr') {
            what = "Pipeline failed on the PR build (PR #${env.CHANGE_ID}, ${env.CHANGE_BRANCH})."
          }
          // Ticket never left In Progress on this run, so there's nothing to
          // transition back -- just post attributable evidence and ask
          // ScrumMaster to redispatch the ticket's own recorded owner. The
          // message never names an agent (REQ-11) -- ScrumMaster is the only
          // thing allowed to decide who that is. A failed comment must not
          // swallow the retry signal, so each step is best-effort.
          withEnv(["FAILED_TICKETS=${tickets.join(' ')}", "FAILURE_TEXT=${what}"]) {
            sh '''
              for ticket in $FAILED_TICKETS; do
                COMMENT_TEXT=$(printf '%s\\n\\nBuild log: %s\\n\\nPlease review and fix.' "$FAILURE_TEXT" "$BUILD_URL")
                curl -sS --fail-with-body -u "$JIRA_EMAIL:$JIRA_TOKEN" -X POST \
                    -H 'Content-Type: application/json' \
                    -d "$(jq -n --arg text "$COMMENT_TEXT" '{body:{type:"doc",version:1,content:[{type:"paragraph",content:[{type:"text",text:$text}]}]}}')" \
                    "$JIRA_URL/rest/api/3/issue/$ticket/comment" > /dev/null \
                  || echo "WARN: could not post failure comment to $ticket" >&2
                redis-cli -h "$REDIS_HOST" publish "jira-gateway:$PROJECT_NAME" \
                    "$(jq -nc --arg t "$ticket" --arg u "$BUILD_URL" --arg n "$BUILD_NUMBER" '{type:"pipeline_retry",ticket_key:$t,build_url:$u,build_number:$n}')" \
                  || echo "WARN: could not publish pipeline_retry for $ticket" >&2
              done
            '''
          }
        }
      }
    }
  }
}
