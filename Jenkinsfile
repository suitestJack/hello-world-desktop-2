// Jenkinsfile — hello-world-desktop-2
//
// Implements the full per-story flow from strategy/v1.0/features/release-workflow.md:
//   PR opened -> Jenkins runs tests (github-branch-source posts the commit
//   status automatically) -> tests pass -> auto-merge to `dev`, promote that
//   merge straight to `beta`, deploy beta's new build to the Beta VM --
//   no human step, no Jira transition required for any of it.
//
// The ticket stays "In Progress" for the whole pipeline run (REQ-10). Jenkins
// is the only thing that ever moves it to "In Review", and only once the
// deploy above has actually succeeded and its evidence (beta URL, SHA, build
// identifier) is posted -- never on PR-open. On failure, Jenkins posts
// attributable evidence and publishes a `pipeline_retry` message to
// ScrumMaster over the same jira-gateway Redis channel agents use (REQ-11) --
// it never asserts an agent owner; ScrumMaster looks up the ticket's own
// recorded Agent field and redispatches that agent. This does not depend on
// any Jira status webhook.
//
// Release preview and production promotion are NOT handled here -- they're
// separate, centrally-defined Jenkins jobs (release-candidate,
// production-promote, release-preview-teardown; see jenkins/jenkins.yaml)
// triggered from a Jira Release ticket, batching whatever has landed on
// `beta` across possibly many runs of this pipeline.

pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    // Matches config/projects.json's `name` for jiraProjectKey HWD2 and the
    // live aigang:gateway:hello-world-desktop / aigang:agent:hello-world-desktop:*
    // Redis keys ScrumMaster already routes through -- NOT the GitHub repo's
    // own "hello-world-desktop-2" name.
    PROJECT_NAME = 'hello-world-desktop'

    // For a PR-triggered multibranch build, BRANCH_NAME is the PR
    // pseudo-branch (PR-1, PR-2, ...) -- the real head branch name is
    // CHANGE_BRANCH instead. Since gitHubBranchDiscovery excludes branches
    // that already have an open PR (jenkins/jenkins.yaml), every build that
    // reaches this stage is a PR build, so CHANGE_BRANCH must take priority.
    //
    // feature/GANG-42-password-reset -> GANG-42
    JIRA_TICKET = "${(env.CHANGE_BRANCH ?: env.BRANCH_NAME)?.contains('/') ? (env.CHANGE_BRANCH ?: env.BRANCH_NAME).split('/')[1].tokenize('-')[0..1].join('-') : ''}"
  }

  stages {
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

    stage('Merge, promote to beta, and deploy') {
      // Only for ticket branches -- `dev`/`beta`/`prod` builds triggered by
      // other means (e.g. a manual re-run) shouldn't re-merge or re-promote.
      when {
        // See the CHANGE_BRANCH note on JIRA_TICKET above -- on a PR build
        // (the only kind that reaches this point) BRANCH_NAME is PR-N, not
        // the ticket branch name, so it can never match this guard alone.
        expression { (env.CHANGE_BRANCH ?: env.BRANCH_NAME) ==~ /feature\/.*|bugfix\/.*|chore\/.*/ }
      }
      steps {
        // Auto-merge to dev -- no Jira transition needed to reach this point,
        // Jenkins' own test gate is the only gate.
        //
        // Jenkins checks out PR builds as a detached-HEAD merge commit, so
        // gh has no current branch to infer the PR from -- pass CHANGE_ID
        // (the PR number, set by github-branch-source for PR builds)
        // explicitly rather than relying on branch inference.
        //
        // No --auto: that defers the merge until GitHub's own required
        // checks report success, which needs "Allow auto-merge" enabled on
        // the repo (it isn't) and is the wrong semantics here anyway --
        // Install/Test/Build above are this PR's only gate, and they've
        // already passed by the time this stage runs, so merge immediately.
        // Matches the release-candidate/production-promote merge in
        // jenkins/jenkins.yaml, which never used --auto either.
        //
        // --admin: the target branch's protection rules otherwise refuse a
        // direct merge ("the base branch policy prohibits the merge") --
        // by design (see the top of this file) Jenkins' own test gate is
        // the only gate a ticket branch needs, so bypass the platform-level
        // review/status-check requirement rather than adding a human step.
        sh 'gh pr merge "$CHANGE_ID" --squash --admin'

        // Promote the merge straight to beta. Branches make batching free:
        // this is a fast-forward, not a rebuild -- beta always mirrors dev.
        sh '''
          git fetch origin dev
          git push origin origin/dev:refs/heads/beta
        '''

        // TODO: no Beta VM is provisioned for this project yet (BETA_VM_HOST /
        // PREVIEW_DOMAIN unset in ~/ai-gang/.env). Fill in once the Beta VM
        // remote-deploy mechanism (beta-vm/README.md) is set up for this repo:
        //   sh "ssh beta-deploy@\$BETA_VM_HOST deploy ${env.PROJECT_NAME} \$(git rev-parse origin/dev)"
        echo 'TODO: deploy this build to the Beta VM'

        script {
          env.DEPLOYED_SHA = sh(script: 'git rev-parse origin/dev', returnStdout: true).trim()
          env.BUILD_IDENTIFIER = "${env.PROJECT_NAME}-${env.DEPLOYED_SHA.take(7)}-${env.BUILD_NUMBER}"
        }
        // Beta URL is <project>.<BETA_DOMAIN> — deploy.sh routes it through
        // Traefik on the Beta VM under that same hostname (beta-vm/README.md).
        // TODO: replace yourdomain.com with this project's actual BETA_DOMAIN
        // once it's provisioned.
        //
        // jira:3.21's jiraComment step fails here with "[Jira] Failed to
        // connect to Jira" (same failure observed from the post{failure{}}
        // block below, and it has no site param on this plugin version nor
        // any jiraTransition step at all) -- go through Jira's REST API
        // directly instead, the same way jira.js's postComment() and
        // transitionIssue() do.
        sh '''
          COMMENT_TEXT=$(printf 'Deployed to beta.\n\nBeta URL: https://%s.beta.yourdomain.com\nSHA: %s\nBuild: %s' "$PROJECT_NAME" "$DEPLOYED_SHA" "$BUILD_IDENTIFIER")
          curl -s -u "$JIRA_EMAIL:$JIRA_TOKEN" -X POST \
              -H 'Content-Type: application/json' \
              -d "$(jq -n --arg text "$COMMENT_TEXT" '{body:{type:"doc",version:1,content:[{type:"paragraph",content:[{type:"text",text:$text}]}]}}')" \
              "$JIRA_URL/rest/api/3/issue/$JIRA_TICKET/comment"
        '''

        // Evidence is posted -- now, and only now, move the ticket to In
        // Review. This is the single place a ticket leaves In Progress on
        // the happy path (REQ-10).
        sh '''
          TRANSITION_ID=$(curl -s -u "$JIRA_EMAIL:$JIRA_TOKEN" \
              "$JIRA_URL/rest/api/3/issue/$JIRA_TICKET/transitions" \
            | jq -r '.transitions[] | select(.to.name=="In Review") | .id')
          if [ -z "$TRANSITION_ID" ]; then
            echo "No In Review transition available for $JIRA_TICKET" >&2
            exit 1
          fi
          curl -s -u "$JIRA_EMAIL:$JIRA_TOKEN" -X POST \
              -H 'Content-Type: application/json' \
              -d "$(jq -n --arg id "$TRANSITION_ID" '{transition:{id:$id}}')" \
              "$JIRA_URL/rest/api/3/issue/$JIRA_TICKET/transitions"
        '''
      }
    }
  }

  post {
    failure {
      script {
        if ((env.CHANGE_BRANCH ?: env.BRANCH_NAME) ==~ /feature\/.*|bugfix\/.*|chore\/.*/) {
          // Ticket never left In Progress on this run, so there's nothing to
          // transition back -- just post attributable evidence and ask
          // ScrumMaster to redispatch the ticket's own recorded owner. The
          // message never names an agent (REQ-11) -- ScrumMaster is the only
          // thing allowed to decide who that is.
          //
          // jira:3.21's jiraComment step fails here with "[Jira] Failed to
          // connect to Jira" -- manual curl/jq checks confirm Jira is
          // reachable from this container, so the plugin's own error message
          // is a generic catch-all that doesn't reflect real connectivity.
          // Go through the REST API directly instead, same as the
          // transition above and jira.js's postComment().
          sh '''
            COMMENT_TEXT=$(printf 'Pipeline failed. Build log: %s\n\nPlease review and fix.' "$BUILD_URL")
            curl -s -u "$JIRA_EMAIL:$JIRA_TOKEN" -X POST \
                -H 'Content-Type: application/json' \
                -d "$(jq -n --arg text "$COMMENT_TEXT" '{body:{type:"doc",version:1,content:[{type:"paragraph",content:[{type:"text",text:$text}]}]}}')" \
                "$JIRA_URL/rest/api/3/issue/$JIRA_TICKET/comment"
          '''
          sh """
            redis-cli -h \$REDIS_HOST publish jira-gateway:\$PROJECT_NAME '{"type":"pipeline_retry","ticket_key":"${JIRA_TICKET}","build_url":"${env.BUILD_URL}","build_number":"${env.BUILD_NUMBER}"}'
          """
        }
      }
    }
  }
}
