# GenreTagging Deployment Strategy

**Last Updated:** 2026-03-18
**Status:** Planning document for transition from single-user to multi-user app
**Target:** App store submission + 10 friends beta + eventual wider sharing

---

## Current State (Today)

### What We Have
- ✅ Fully functional single-user DJ/music app
- ✅ Robust health checks and auto-recovery
- ✅ Blue-green deployment with emergency rollback
- ✅ Manual deploy trigger (prevents cascading failures)
- ✅ Multiple access methods (SSM, Instance Connect, CloudShell)
- ✅ Docker containerized on AWS EC2 (t3.small, $17/month)

### Critical Limitation
```
The app uses in-memory _state dict (Python dictionary holding playlist, caches, etc.)
Multiple workers/users = multiple copies of state = BREAKS
This is a FUNDAMENTAL ARCHITECTURAL BLOCKER for multi-user
```

### Current Infrastructure Complexity
- AWS EC2 with manual infrastructure management
- Blue-green deployment (enterprise-level for a hobby app)
- Multiple access method troubleshooting (today's incident)
- Manual deploy trigger requirement

---

## Recommended Path: Fly.io

### Why Fly.io?

| Aspect | AWS EC2 | Fly.io |
|--------|---------|--------|
| **Cost** | $17/month | ~$5/month (basically free tier) |
| **Deploy** | Click GitHub Actions manually | `git push` (auto) |
| **HTTPS** | Manual + Let's Encrypt | Automatic |
| **Health Checks** | We manage it | Built-in, automatic |
| **Monitoring** | We debug manually | Built-in dashboard |
| **Scaling** | We configure it | Automatic (to thousands of users) |
| **Database** | Need to add RDS | Easy integration (Postgres) |
| **Access to Instance** | SSH/SSM/Instance Connect | Don't need it (managed service) |

### Key Advantage
**You stop managing infrastructure and start building features.**

### Scaling Capacity
- **Single-user (now)**: Fine on either platform
- **10 friends (soon)**: Fly.io handles easily
- **100+ users (later)**: Fly.io still handles fine (if app architecture is proper)
- **1000+ users (future)**: Fly.io + proper database scales to this

---

## Three-Phase Rollout Plan

### Phase 1: Immediate (This Week) — Wrap & Move to Fly.io

**Duration:** 2-3 hours
**Goal:** Get the current app running reliably on Fly.io, remove infrastructure hassle

#### What To Do
1. **Clean up current code**
   - [ ] Remove any TODO comments related to "deploy"
   - [ ] Final testing on EC2 (make sure app works)
   - [ ] Verify all features working end-to-end

2. **Move to Fly.io** (30 minutes)
   ```bash
   # Install Fly CLI
   brew install flyctl

   # Authenticate
   flyctl auth login

   # Launch your app
   flyctl launch
   # It will auto-detect your Dockerfile and ask a few questions
   # Answer: app name, region (pick closest to you), database (no, not yet)

   # Deploy
   flyctl deploy
   ```

3. **Verify it works**
   - [ ] Test at your new Fly.io domain
   - [ ] Test all features (tagging, tree building, playback, etc.)
   - [ ] Check logs: `flyctl logs`

4. **Update devops.md**
   - [ ] Document Fly.io setup
   - [ ] Remove AWS EC2 specifics
   - [ ] Add Fly.io troubleshooting (monitoring, logs, rollback)

5. **Optional: Keep EC2 for now**
   - Don't delete EC2 instance immediately
   - Keep it running for a week to ensure Fly.io is stable
   - Then terminate EC2 to save $17/month

#### Deliverables
- ✅ App running on Fly.io
- ✅ Auto-deploys on push to `main`
- ✅ HTTPS working
- ✅ Updated devops.md
- ✅ EC2 optionally terminated (save cost)

#### Why This First?
- Frees you from infrastructure management immediately
- Gives you confidence before adding multi-user complexity
- Easier to test features without worrying about deployment

---

### Phase 2: Multi-User Support (Next Month) — Database Integration

**Duration:** 1-2 weeks of development
**Goal:** Rewrite state layer to support multiple users with separate data

#### Current Architecture Problem
```python
# CURRENT (single-user):
_state = {
    "df": playlist_dataframe,          # ONE user's data
    "artwork_cache": {...},           # ONE user's cache
    "analysis_cache": {...}           # ONE user's analysis
}
# If 2 users access at same time: COLLISION, DATA CORRUPTION
```

#### New Architecture (Multi-User)
```python
# WITH DATABASE:
# User 1: Database row with their playlist + settings
# User 2: Database row with their playlist + settings
# No collision, each user sees their own data
```

#### What Needs to Change

**1. Add User Authentication**
```python
# New endpoint structure:
POST /api/users/register
POST /api/users/login
GET /api/users/me (returns current user)

# Every request includes: Authorization: Bearer <jwt_token>
# Backend validates token and knows which user is making the request
```

**2. Replace In-Memory State with Database**
```python
# Instead of _state["df"] (in memory)
# Query: SELECT playlist FROM playlists WHERE user_id = ?

# Database schema:
Users:
  - id (primary key)
  - email
  - password_hash
  - created_at

Playlists:
  - id
  - user_id (foreign key)
  - csv_data (the uploaded CSV)
  - created_at
  - updated_at

Sets:
  - id
  - user_id
  - name
  - tracks (JSON array or separate table)
  - created_at

Trees:
  - id
  - user_id
  - name
  - structure (JSON)
  - created_at
```

**3. Update API Endpoints**
```python
# Before (implicit user):
GET /api/playlists
GET /api/playlists/<id>/analyze

# After (explicit user from token):
GET /api/playlists          # Returns playlists for authenticated user only
POST /api/playlists         # Creates playlist for authenticated user
GET /api/playlists/<id>/analyze  # User must own this playlist
```

**4. Store Files Per User**
```
# Current (single user):
/output/artwork/<md5>.jpg

# New (multi-user):
/output/users/<user_id>/artwork/<md5>.jpg
/output/users/<user_id>/playlists/<playlist_id>.csv
```

#### Implementation Steps
1. [ ] Set up Postgres database on Fly.io
   ```bash
   flyctl postgres create  # Creates managed Postgres instance
   ```

2. [ ] Add ORM/database library to your app
   ```bash
   uv add sqlalchemy        # Or use any Python ORM you prefer
   uv add psycopg2          # Postgres driver
   ```

3. [ ] Create database schema (User, Playlist, Set, Tree tables)

4. [ ] Add authentication system
   - Simple: JWT tokens (stateless, good for APIs)
   - Medium: Session cookies + database sessions
   - Choose based on your needs

5. [ ] Migrate route handlers
   - Change from `_state["df"]` to database queries
   - Add user_id checks to all endpoints
   - Update file storage paths

6. [ ] Migrate existing user's data
   - One-time migration script
   - User ID = some default (e.g., UUID)
   - Create "default" user account for you

7. [ ] Test multi-user scenarios
   - [ ] Two users upload different playlists
   - [ ] Verify they see only their own data
   - [ ] Verify playback works for both
   - [ ] Verify tagging is per-user

#### Code Changes Example
```python
# BEFORE (current, single-user):
@app.route('/api/playlists')
def get_playlists():
    df = _state["df"]
    return jsonify(df.to_dict('records'))

# AFTER (multi-user):
@app.route('/api/playlists')
@require_auth  # Decorator to extract user from JWT
def get_playlists(user):
    playlists = db.session.query(Playlist).filter_by(user_id=user.id).all()
    return jsonify([p.to_dict() for p in playlists])
```

#### Deliverables
- ✅ Database schema designed and migrated
- ✅ User authentication working
- ✅ All routes updated to use database
- ✅ All routes checking user_id for authorization
- ✅ File storage per user working
- ✅ 10 friends can sign up and use independently
- ✅ Each friend sees only their own data

#### Why This Second?
- Phase 1 (Fly.io) removed infrastructure distraction
- Now you can focus purely on application logic
- Database changes are self-contained (no infrastructure needed)
- Friends can beta-test while you refine

---

### Phase 3: App Store Ready (Month 3) — Polish & Security

**Duration:** 1-2 weeks
**Goal:** Get app production-ready for App Store submission and wider sharing

#### Requirements for App Store
1. [ ] **HTTPS/SSL** — Already automatic on Fly.io ✅
2. [ ] **User authentication** — Done in Phase 2 ✅
3. [ ] **Rate limiting** — Prevent abuse
   ```python
   from flask_limiter import Limiter

   limiter = Limiter(app, key_func=lambda: current_user.id)

   @app.route('/api/analyze', methods=['POST'])
   @limiter.limit("5 per minute per user")  # Max 5 analyses per minute
   def analyze_playlist():
       ...
   ```

4. [ ] **Error handling** — User-friendly errors, not server exceptions
5. [ ] **Logging & monitoring** — Track errors, user behavior
6. [ ] **Security audit**
   - [ ] SQL injection prevention (SQLAlchemy ORM prevents this)
   - [ ] XSS prevention (validate input)
   - [ ] CSRF protection if using cookies
   - [ ] Password hashing (bcrypt, not plaintext)
   - [ ] JWT secrets strong and rotated

7. [ ] **Terms of Service & Privacy Policy**
   - Required for App Store
   - Document what data you collect
   - Document how data is used

8. [ ] **API versioning**
   - Start with `/api/v1/...` endpoints
   - Allows for future changes without breaking old clients

9. [ ] **Comprehensive error messages**
   ```python
   # Bad:
   return {"error": "Error"}, 500

   # Good:
   return {
       "error": "Invalid playlist format",
       "message": "CSV must contain 'artist' and 'title' columns",
       "status": 400
   }, 400
   ```

10. [ ] **Load testing**
    - Test with simulated 10 users
    - Test with simulated 100 users
    - Verify database queries are efficient

#### Deliverables
- ✅ Rate limiting on API endpoints
- ✅ Proper error handling and logging
- ✅ Security best practices implemented
- ✅ Terms of Service & Privacy Policy written
- ✅ Load test results documented
- ✅ App ready for App Store submission
- ✅ App ready for wider sharing

#### Why This Third?
- Core functionality (Phases 1 & 2) is solid first
- Security/polish is last because requirements may change based on user feedback
- You'll understand the app's usage patterns by then

---

## Timeline Estimate

| Phase | Time | When |
|-------|------|------|
| **Phase 1:** Fly.io + wrap features | 2-3 hours | This week |
| **Phase 2:** Multi-user database | 1-2 weeks | Next month |
| **Phase 3:** App store polish | 1-2 weeks | Month 3 |
| **Total** | **3-5 weeks** | **Next 3 months** |

---

## Key Decisions You Need to Make

### 1. Database Choice
- **Postgres** (recommended) — Reliable, full-featured, Fly.io integrates well
- **SQLite** — Simpler, but doesn't scale as well (Fly.io filesystem is ephemeral)
- **MySQL** — Also good, but Postgres is more popular for Python apps

### 2. Authentication Method
- **JWT tokens** (stateless, good for APIs, what mobile apps use) — Recommended
- **Session cookies** (stateful, traditional web app style)
- **OAuth** (delegate to Google/GitHub, more complex but user-friendly)

### 3. ORM Library
- **SQLAlchemy** (most popular, battle-tested) — Recommended
- **Django ORM** (only if you switch to Django framework)
- **Tortoise ORM** (async-friendly if you add async later)

### 4. Deployment on App Store
- **iOS**: Use same backend, wrap in React Native or Flutter
- **Android**: Same approach
- Or: Use Expo/React Native for both platforms simultaneously

---

## Infrastructure Costs Comparison

### Current (AWS EC2)
- EC2: $17/month
- Total: **$17/month**

### With Fly.io (Phase 1)
- Fly.io: ~$5/month (free tier covers your app)
- Total: **$5/month** (saves $12/month immediately)

### With Database (Phase 2+)
- Fly.io: ~$5/month
- Postgres (managed): ~$15/month
- Total: **~$20/month** (but scales to 1000s of users)

---

## When NOT to Do This Plan

**This plan assumes:**
- ✅ You want to move to a managed platform (Fly.io)
- ✅ You can commit time to database refactor (Phase 2)
- ✅ You want your friends to use the app soon
- ✅ You're done adding features to the current architecture

**If instead:**
- ❌ You want to keep learning AWS infrastructure
- ❌ You want to keep the current single-user setup longer
- ❌ You're not ready to refactor the state layer

...then keep the current EC2 setup and simplify just the deployment (remove blue-green complexity).

---

## Next Steps

### Immediate (This Week)
1. [ ] Review this document
2. [ ] Decide: Fly.io now, or keep AWS longer?
3. [ ] If Fly.io: Set up account and deploy
4. [ ] If AWS: Simplify deploy.yml (remove blue-green)
5. [ ] Update team on decision

### If Going Fly.io
1. [ ] `flyctl auth login`
2. [ ] `cd GenreTagging && flyctl launch`
3. [ ] `flyctl deploy`
4. [ ] Test app at Fly.io domain
5. [ ] Update devops.md with Fly.io instructions
6. [ ] Terminate EC2 instance (optional, saves cost)

### For Phase 2 Planning (Next Month)
1. [ ] Decide on ORM + auth method
2. [ ] Design database schema
3. [ ] Create migration plan for existing data
4. [ ] Build user registration/login flow
5. [ ] Refactor route handlers one at a time

---

## Questions?

- **"What if I don't want to add users?"** → Stop at Phase 1, you're done
- **"What if I want to keep AWS?"** → Phase 1 can be "simplify deploy", skip Fly.io
- **"What if I add users but want to stay single-user for now?"** → Phase 2 is modular, do parts gradually
- **"How do I migrate user data from Phase 1 to Phase 2?"** → Write a migration script (straightforward one-time thing)

---

**Document Author:** Claude (2026-03-18)
**Last Review:** None
**Next Review:** After Phase 1 completion
