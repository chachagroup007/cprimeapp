require("dotenv").config();
const express=require("express"), helmet=require("helmet"), cors=require("cors"), mysql=require("mysql2/promise");
const app=express(); app.disable("x-powered-by"); app.use(helmet());
const origins=(process.env.ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
app.use(cors({origin:origins.length?origins:false})); app.use(express.json({limit:"256kb"}));
let pool;
function db(){if(!process.env.DB_HOST||!process.env.DB_NAME||!process.env.DB_USER)throw new Error("Database environment is not configured");if(!pool)pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD||"",waitForConnections:true,connectionLimit:5,charset:"utf8mb4"});return pool;}
app.get("/health",(_req,res)=>res.json({ok:true,service:"chachaprime-group-buying",version:"0.1.0"}));
app.get("/api/deals",async(_req,res,next)=>{try{const [rows]=await db().query("SELECT id,title,status,target_quantity,current_quantity,starts_at,ends_at,created_at FROM group_deals WHERE status IN ('draft','scheduled','active') ORDER BY created_at DESC LIMIT 100");res.json({deals:rows});}catch(e){next(e);}});
app.use((err,_req,res,_next)=>{console.error("Request failed:",err.message);res.status(500).json({error:"Internal server error"});});
const port=Number(process.env.PORT||3000);app.listen(port,"0.0.0.0",()=>console.log("ChachaPrime API listening on",port));
