'use client';
import {useCare} from './care-context';
import {ActionButton,Badge,time,words} from './ui';
import TaskComposer from './TaskComposer';

export function TaskList({tasks,title='Follow-up tasks'}){
 const care=useCare();
 return <section className="panel"><div className="section-heading"><h2>{title}</h2><span className="count">{tasks.length}</span></div>
 {tasks.length?tasks.map(task=><article className="feed-row" key={task.id}><div><button className="text-button" onClick={()=>care.setSelected(task.resident_id,'tasks')}>{task.resident?.name} · Room {task.resident?.room}</button><p><strong>{task.title}</strong></p><p className="task-assignee">Assigned to {task.assignee?.name||'Unassigned'} · Due {time(task.due_at)}</p><Badge>{words(task.status)}</Badge></div>
 <select className="task-reassign" aria-label={`Assign ${task.title}`} value={task.assigned_to||''} onChange={event=>{void care.perform(`/api/tasks/${task.id}`,{assigned_to:event.target.value}).catch(e=>care.setError(e.message));}}>{care.staff.filter(s=>!s.facility_id||s.facility_id===task.resident?.facility_id).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
 {task.status!=='completed'&&<ActionButton action={()=>care.perform(`/api/tasks/${task.id}`,{status:{assigned:'accepted',accepted:'in_progress',in_progress:'completed'}[task.status]})}>{task.status==='assigned'?'Accept':task.status==='accepted'?'Start':'Complete'}</ActionButton>}
 </article>):<p className="empty">No tasks in this view.</p>}</section>;
}
export default function FollowUpWorkspace(){
 const care=useCare();
 return <div className="care-stack"><TaskComposer/><TaskList tasks={care.tasks}/></div>;
}
