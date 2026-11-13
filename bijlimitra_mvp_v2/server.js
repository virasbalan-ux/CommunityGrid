
const express=require("express"),session=require("express-session"),bcrypt=require("bcryptjs"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const { spawn } = require("child_process");
const app=express(),PORT=3000,DIR=path.join(__dirname,"data"),FILE=path.join(DIR,"db.json");
fs.mkdirSync(DIR,{recursive:true});
app.use(express.json());
app.use(session({secret:process.env.SESSION_SECRET||"change-this-secret",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",maxAge:8*3600000}}));
const id=p=>p+"_"+crypto.randomUUID(),now=()=>new Date().toISOString();
function db(){if(!fs.existsSync(FILE))seed();let d=JSON.parse(fs.readFileSync(FILE));for(const k of ["users","incidents","reports","notifications","plannedOutages","complaintLog"])if(!Array.isArray(d[k]))d[k]=[];return d}
function save(d){fs.writeFileSync(FILE,JSON.stringify(d,null,2))}
function seed(){let users=[
{username:"asha",password:"demo123",name:"Asha Rao",housingType:"apartment",apartment:"Green Valley Apartments",block:"A",flat:"101",locality:"Green Valley",street:"Lake Road"},
{username:"rahul",password:"demo123",name:"Rahul Nair",housingType:"apartment",apartment:"Green Valley Apartments",block:"A",flat:"102",locality:"Green Valley",street:"Lake Road"},
{username:"meera",password:"demo123",name:"Meera Shah",housingType:"independent",locality:"Green Valley",street:"Lake Road",houseNumber:"18"},
{username:"dev",password:"demo123",name:"Dev Kumar",housingType:"independent",locality:"Green Valley",street:"Lake Road",houseNumber:"20"}].map(u=>({...u,id:id("usr"),role:"resident",passwordHash:bcrypt.hashSync(u.password,10),createdAt:now()}));
users.push({id:id("usr"),username:"admin",passwordHash:bcrypt.hashSync("admin123",10),role:"admin",name:"Locality Handler"});
fs.writeFileSync(FILE,JSON.stringify({users,incidents:[],reports:[],notifications:[],plannedOutages:[],complaintLog:[]},null,2))}
function group(u){return u.housingType==="apartment"?`apt:${(u.apartment||"").toLowerCase()}|${(u.block||"").toLowerCase()}`:`street:${(u.locality||"").toLowerCase()}|${(u.street||"").toLowerCase()}`}
function runDetector(payload) {
    return new Promise((resolve, reject) => {
        const root = path.resolve(__dirname, "..");
        const python = process.platform === "win32"
            ? path.join(root, ".venv", "Scripts", "python.exe")
            : path.join(root, ".venv", "bin", "python");

        const child = spawn(
            python,
            [path.join(root, "detector_bridge.py")],
            { cwd: root }
        );

        let output = "";
        let errors = "";

        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error("Outage detection timed out."));
        }, 30000);

        child.stdout.on("data", chunk => {
            output += chunk.toString();
        });

        child.stderr.on("data", chunk => {
            errors += chunk.toString();
        });

        child.on("error", error => {
            clearTimeout(timeout);
            reject(error);
        });

        child.stdin.on("error", error => {
            clearTimeout(timeout);
            reject(error);
        });

        child.on("close", code => {
            clearTimeout(timeout);

            if (code !== 0) {
                console.error("Detector error:", errors);
                return reject(new Error("Outage detection failed."));
            }

            try {
                resolve(JSON.parse(output));
            } catch {
                reject(new Error("Invalid response from detector."));
            }
        });

        child.stdin.end(JSON.stringify(payload));
    });
}
function buildingId(u) {
    const normalize = value =>
        String(value || "").trim().toLowerCase();

    const locality = normalize(u.locality);

    if (u.housingType === "apartment") {
        const apartment = normalize(u.apartment);
        const block = normalize(u.block);

        if (!locality || !apartment || !block) return null;

        return JSON.stringify([
            "apartment", locality, apartment, block
        ]);
    }

    if (u.housingType === "independent") {
        const street = normalize(u.street);
        const house = normalize(u.houseNumber);

        if (!locality || !street || !house) return null;

        return JSON.stringify([
            "house", locality, street, house
        ]);
    }

    return null;
}
function safe(u){if(!u)return null;let {passwordHash,houseNumber,...x}=u;return x}
function auth(q,s,n){if(!q.session.uid)return s.status(401).json({error:"Please log in."});n()}
function current(d,q){return d.users.find(u=>u.id===q.session.uid)}
function notify(d,uid,title,message,incidentId=null){d.notifications.push({id:id("ntf"),userId:uid,title,message,incidentId,read:false,createdAt:now()})}
function residents(d,k){return d.users.filter(u=>u.role==="resident"&&group(u)===k)}
function askHomeCheck(d,i){if(i.homeCheckPrompted)return;i.homeCheckPrompted=true;let original=d.reports.find(r=>r.incidentId===i.id&&r.kind==="outage");if(original)notify(d,original.userId,"Please complete a home-level check","No neighbour has confirmed that this is a wider outage. Check whether the issue is limited to your home. You may still lodge an official complaint if unclear.",i.id)}
app.get("/api/health",(q,s)=>s.json({ok:true}));
app.post("/api/register",async(q,s)=>{let b=q.body||{};if(!b.username||!b.password||!b.name||!b.locality||!["apartment","independent"].includes(b.housingType))return s.status(400).json({error:"Fill all required details."});if(b.housingType==="apartment"&&(!b.apartment||!b.block||!b.flat))return s.status(400).json({error:"Enter apartment, block and flat."});if(b.housingType==="independent"&&(!b.street||!b.houseNumber))return s.status(400).json({error:"Enter street and house number."});let d=db();if(d.users.some(u=>u.username.toLowerCase()===b.username.toLowerCase()))return s.status(409).json({error:"Username already exists."});let u={...b,id:id("usr"),role:"resident",passwordHash:await bcrypt.hash(b.password,10),createdAt:now()};delete u.password;d.users.push(u);save(d);q.session.uid=u.id;s.json({user:safe(u)})});
app.post("/api/login",async(q,s)=>{let d=db(),u=d.users.find(x=>x.username.toLowerCase()===String(q.body.username||"").toLowerCase());if(!u||!await bcrypt.compare(q.body.password||"",u.passwordHash))return s.status(401).json({error:"Invalid username or password."});q.session.uid=u.id;s.json({user:safe(u)})});
app.post("/api/logout",(q,s)=>q.session.destroy(()=>s.json({ok:true})));
app.get("/api/me",(q,s)=>auth(q,s,()=>s.json({user:safe(current(db(),q))})));
app.get("/api/dashboard",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q),k=group(u),active=d.incidents.filter(i=>i.groupKey===k&&!["restored","closed"].includes(i.status));
for(let i of active){let own=d.reports.find(r=>r.incidentId===i.id&&r.kind==="outage");let replies=d.reports.filter(r=>r.incidentId===i.id&&r.kind==="neighbor_response");if(own&&own.userId===u.id&&!i.homeCheckPrompted&&i.status!=="community_confirmed"&&Date.now()-Date.parse(i.createdAt)>=5*60000&&replies.length===0)askHomeCheck(d,i)}
save(d);s.json({user:safe(u),activeIncidents:active,history:d.incidents.filter(i=>i.groupKey===k).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),reports:d.reports.filter(r=>r.userId===u.id),notifications:d.notifications.filter(n=>n.userId===u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),plannedOutages:d.plannedOutages.filter(p=>p.locality.toLowerCase()===(u.locality||"").toLowerCase())})}));
app.post("/api/incidents/report",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q);if(u.role!=="resident")return s.status(403).json({error:"Resident account only."});const body = q.body || {};
const hasLat = body.lat !== undefined;
const hasLon = body.lon !== undefined;

let location = null;

if (hasLat || hasLon) {
    if (
        typeof body.lat !== "number" ||
        typeof body.lon !== "number" ||
        !Number.isFinite(body.lat) ||
        !Number.isFinite(body.lon) ||
        body.lat < -90 || body.lat > 90 ||
        body.lon < -180 || body.lon > 180
    ) {
        return s.status(400).json({
            error: "Provide valid numeric latitude and longitude."
        });
    }

    location = {
        lat: body.lat,
        lon: body.lon
    };
}let k=group(u),i=d.incidents.find(x=>x.groupKey===k&&!["restored","closed"].includes(x.status)&&Date.now()-Date.parse(x.createdAt)<86400000),joined=!!i;
if(!i){i={id:id("inc"),groupKey:k,locality:u.locality,areaLabel:u.housingType==="apartment"?`${u.apartment}, Block ${u.block}`:`${u.locality}, ${u.street}`,status:"reported",createdAt:now(),reportsCount:0,confirmationCount:0,homeCheckPrompted:false,complaintReference:""};d.incidents.push(i);residents(d,k).filter(x=>x.id!==u.id).forEach(x=>notify(d,x.id,"Power outage reported nearby",`${u.name} reported an outage. Are you also affected?`,i.id))}
if(!d.reports.some(r=>r.incidentId===i.id&&r.userId===u.id)){d.reports.push({
    id: id("rep"),
    incidentId: i.id,
    userId: u.id,
    kind: "outage",
    affected: true,
    createdAt: now(),
    location: location,
    building_id: buildingId(u)
});i.reportsCount++}save(d);s.json({incident:i,joinedExisting:joined})}));
app.post("/api/incidents/:id/respond",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q),i=d.incidents.find(x=>x.id===q.params.id);if(!i)return s.status(404).json({error:"Incident not found."});if(u.role!=="resident"||group(u)!==i.groupKey)return s.status(403).json({error:"You are not part of this incident's resident group."});if(typeof q.body.affected!=="boolean")return s.status(400).json({error:"affected must be true or false."});
let r=d.reports.find(x=>x.incidentId===i.id&&x.userId===u.id);if(!r){r={id:id("rep"),incidentId:i.id,userId:u.id,kind:"neighbor_response",createdAt:now()};d.reports.push(r)}r.kind="neighbor_response";r.affected=q.body.affected;r.respondedAt=now();
let yes=d.reports.filter(x=>x.incidentId===i.id&&x.kind==="neighbor_response"&&x.affected===true).length,no=d.reports.filter(x=>x.incidentId===i.id&&x.kind==="neighbor_response"&&x.affected===false).length;
i.confirmationCount=yes;
let origin=d.reports.find(x=>x.incidentId===i.id&&x.kind==="outage");
if(yes>0){i.status="community_confirmed";if(origin)notify(d,origin.userId,"Neighbour confirmed the outage",`${u.name} is also affected. This appears to be a wider outage.`,i.id)}
else if(no>0){if(origin)notify(d,origin.userId,"Neighbour response received",`${u.name} says their power is on. Please complete the home-level check if your home is still without power.`,i.id);askHomeCheck(d,i)}
save(d);s.json({ok:true,affected:q.body.affected,incident:i,yesCount:yes,noCount:no})}));
app.post("/api/incidents/:id/home-check",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q),i=d.incidents.find(x=>x.id===q.params.id),r=d.reports.find(x=>x.incidentId===q.params.id&&x.kind==="outage");if(!i)return s.status(404).json({error:"Incident not found."});if(!r||r.userId!==u.id)return s.status(403).json({error:"Only the original reporter can complete this check."});if(i.status==="community_confirmed")return s.status(409).json({error:"A neighbour confirmed a wider outage; home check is hidden."});r.checklist={nearbyOut:!!q.body.nearbyOut,breakerTripped:!!q.body.breakerTripped,hazard:!!q.body.hazard,notes:q.body.notes||"",checkedAt:now()};save(d);s.json({ok:true,message:q.body.hazard?"Electrical hazard indicated. Keep away and contact the utility or a qualified electrician.":"Home check saved. You may proceed to lodge an official complaint."})}));
app.post("/api/incidents/:id/complaint",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q),i=d.incidents.find(x=>x.id===q.params.id);if(!i)return s.status(404).json({error:"Incident not found."});if(u.role!=="admin"&&!d.reports.some(r=>r.incidentId===i.id&&r.userId===u.id))return s.status(403).json({error:"Not authorized."});i.provider=q.body.provider||"Not specified";i.complaintReference=q.body.reference||"Pending";i.status="complaint_lodged";i.complaintAt=now();d.complaintLog.push({id:id("cmp"),incidentId:i.id,provider:i.provider,reference:i.complaintReference,createdAt:now()});residents(d,i.groupKey).forEach(x=>notify(d,x.id,"Official complaint recorded",`Provider: ${i.provider}; reference: ${i.complaintReference}`,i.id));save(d);s.json({ok:true,incident:i})}));
app.post("/api/incidents/:id/restore",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q),i=d.incidents.find(x=>x.id===q.params.id);if(!i)return s.status(404).json({error:"Incident not found."});i.restorationConfirmedBy=i.restorationConfirmedBy||[];if(!i.restorationConfirmedBy.includes(u.id))i.restorationConfirmedBy.push(u.id);i.restorationReportedAt=now();if(u.role==="admin"||i.restorationConfirmedBy.length>=2){i.status="restored";i.restoredAt=now()}else i.status="restoration_reported";residents(d,i.groupKey).forEach(x=>notify(d,x.id,"Restoration update","A resident reported power restored. Please confirm if yours is back too.",i.id));save(d);s.json({incident:i})}));
app.get("/api/admin/overview",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q);if(u.role!=="admin")return s.status(403).json({error:"Admin access only."});s.json({incidents:d.incidents,plannedOutages:d.plannedOutages})}));
app.post("/api/admin/planned-outages",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q);if(u.role!=="admin")return s.status(403).json({error:"Admin access only."});let b=q.body;if(!b.locality||!b.startAt||!Number(b.durationHours)||Number(b.durationHours)<=0)return s.status(400).json({error:"Enter locality, start time and positive duration."});let p={id:id("plan"),locality:b.locality.trim(),title:b.title||"Planned power outage",startAt:new Date(b.startAt).toISOString(),durationHours:Number(b.durationHours),reason:b.reason||"Not specified",details:b.details||"",createdAt:now()};d.plannedOutages.push(p);let targets=d.users.filter(x=>x.role==="resident"&&(x.locality||"").toLowerCase()===p.locality.toLowerCase());targets.forEach(x=>notify(d,x.id,"Planned outage notice",`${p.title}. Expected start: ${new Date(p.startAt).toLocaleString()}. Expected duration: ${p.durationHours} hour(s). Reason: ${p.reason}. ${p.details}`,null));save(d);s.json({plannedOutage:p,notifiedResidents:targets.length})}));
app.post("/api/admin/incidents/:id/status",(q,s)=>auth(q,s,()=>{let d=db(),u=current(d,q);if(u.role!=="admin")return s.status(403).json({error:"Admin access only."});let i=d.incidents.find(x=>x.id===q.params.id);if(!i)return s.status(404).json({error:"Incident not found."});i.status=q.body.status;if(i.status==="restored")i.restoredAt=now();residents(d,i.groupKey).forEach(x=>notify(d,x.id,"Outage status updated",`Handler update: ${i.status}`,i.id));save(d);s.json({incident:i})}));
app.post("/api/notifications/read",(q,s)=>auth(q,s,()=>{let d=db();d.notifications.filter(n=>n.userId===q.session.uid).forEach(n=>n.read=true);save(d);s.json({ok:true})}));
app.get("/api/admin/detection", (q, s) => auth(q, s, async () => {
    try {
        const d = db();
        const admin = current(d, q);

        if (!admin || admin.role !== "admin") {
            return s.status(403).json({error: "Admin access only."});
        }

        const residents = d.users.filter(u => u.role === "resident");
        const residentsById = new Map(
            residents.map(u => [u.id, u])
        );

        const activeIncidentIds = new Set(
            d.incidents
                .filter(i => !["restored", "closed"].includes(i.status))
                .map(i => i.id)
        );

        const reports = d.reports
            .filter(r =>
                activeIncidentIds.has(r.incidentId) &&
                r.affected === true &&
                residentsById.has(r.userId)
            )
            .map(r => ({
                userId: r.userId,
                affected: true,
                createdAt: r.respondedAt || r.createdAt,
                location: r.location || null,
                building_id: r.building_id ||
                    buildingId(residentsById.get(r.userId))
            }));

        const result = await runDetector({
            residents: residents.map(u => ({
                id: u.id,
                locality: u.locality
            })),
            reports
        });

        s.json(result);
    } catch (error) {
        console.error(error);
        s.status(500).json({error: "Unable to run outage detection."});
    }
}));
app.use(express.static(path.join(__dirname,"public")));app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public/index.html")));app.listen(PORT,()=>console.log("BijliMitra running at http://localhost:"+PORT));
